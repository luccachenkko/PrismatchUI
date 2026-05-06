import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { parseNumber } from "./money.js";
import type {
  LinkInput,
  ProductInput,
  Recommendation,
  ScrapedPriceResult,
  ShopifyUpdateRequest,
  ShopifyUpdateResult
} from "./types.js";

type RawRow = Record<string, unknown>;

const YES_VALUES = new Set(["ja", "yes", "true", "1", "x", "y"]);
const NO_VALUES = new Set(["nej", "no", "false", "0", "n"]);

export async function readInputWorkbook(filePath: string): Promise<{
  products: ProductInput[];
  links: LinkInput[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const productsSheet = getSheet(workbook, ["Produkter", "Products"]);
  const linksSheet = getSheet(workbook, ["Länkar", "Lankar", "Links"]);

  const products = readRows(productsSheet).map(parseProductRow).filter((row) => row.aktiv);
  const links = readRows(linksSheet).map(parseLinkRow).filter((row) => row.aktiv);

  validateUniqueSkus(products);

  return { products, links };
}

export async function writePriceReport(params: {
  filePath: string;
  recommendations: Recommendation[];
  scrapedPrices: ScrapedPriceResult[];
  updateResults?: ShopifyUpdateResult[];
}): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Shopify Price Matcher MVP";
  workbook.created = new Date();

  addRecommendationsSheet(workbook, params.recommendations);
  addScrapedPricesSheet(workbook, params.scrapedPrices);
  addErrorsSheet(workbook, params.scrapedPrices);
  addShopifySheet(workbook, params.updateResults ?? []);

  await mkdir(path.dirname(params.filePath), { recursive: true });
  await workbook.xlsx.writeFile(params.filePath);
}

export async function readApprovedUpdates(reportPath: string): Promise<ShopifyUpdateRequest[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(reportPath);

  const sheet = getSheet(workbook, ["Rekommendationer"]);
  const rows = readRows(sheet);

  return rows
    .filter((row) => normalizeString(row.status) === "OK")
    .filter((row) => isApproved(row.godkand))
    .map((row) => {
      const newPrice = requiredNumber(row.foreslaget_pris, "foreslaget_pris");
      const oldPrice = requiredNumber(row.shopify_pris_nu, "shopify_pris_nu");
      return {
        sku: requiredString(row.sku, "sku"),
        productId: requiredString(row.shopify_product_id, "shopify_product_id"),
        variantId: requiredString(row.shopify_variant_id, "shopify_variant_id"),
        oldPrice,
        newPrice
      };
    });
}

export async function appendShopifyUpdateResults(
  reportPath: string,
  updateResults: ShopifyUpdateResult[]
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(reportPath);

  const existing = workbook.getWorksheet("Shopify");
  if (existing) {
    workbook.removeWorksheet(existing.id);
  }

  addShopifySheet(workbook, updateResults);
  await workbook.xlsx.writeFile(reportPath);
}

function addRecommendationsSheet(workbook: ExcelJS.Workbook, rows: Recommendation[]): void {
  const sheet = workbook.addWorksheet("Rekommendationer", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [
    "sku",
    "produktnamn",
    "shopify_lager",
    "shopify_pris_nu",
    "billigaste_konkurrent",
    "billigaste_url",
    "billigaste_konkurrentpris",
    "foreslaget_pris",
    "inkopspris",
    "marginal_efter_procent",
    "minsta_tillatna_pris",
    "prisandring_kr",
    "prisandring_procent",
    "status",
    "orsak",
    "godkand",
    "shopify_product_id",
    "shopify_variant_id",
    "timestamp"
  ];

  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow([
      row.sku,
      row.produktnamn,
      row.shopifyLager,
      row.shopifyPrisNu,
      row.billigasteKonkurrent,
      row.billigasteUrl,
      row.billigasteKonkurrentpris,
      row.foreslagetPris,
      row.inkopspris,
      row.marginalEfterProcent,
      row.minstaTillatnaPris,
      row.prisandringKr,
      row.prisandringProcent,
      row.status,
      row.orsak,
      row.godkand,
      row.shopifyProductId,
      row.shopifyVariantId,
      row.timestamp
    ]);
  }

  formatSheet(sheet);
  sheet.getColumn("D").numFmt = "#,##0.00";
  sheet.getColumn("G").numFmt = "#,##0.00";
  sheet.getColumn("H").numFmt = "#,##0.00";
  sheet.getColumn("I").numFmt = "#,##0.00";
  sheet.getColumn("J").numFmt = "0.00";
  sheet.getColumn("K").numFmt = "#,##0.00";
  sheet.getColumn("L").numFmt = "#,##0.00";
  sheet.getColumn("M").numFmt = "0.00";
  for (let rowNumber = 2; rowNumber <= Math.max(rows.length + 1, 200); rowNumber++) {
    sheet.getCell(rowNumber, 16).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"ja,nej"']
    };
  }

  addAutoFilter(sheet, headers.length, rows.length + 1);
}

function addScrapedPricesSheet(workbook: ExcelJS.Workbook, rows: ScrapedPriceResult[]): void {
  const sheet = workbook.addWorksheet("HamtaPriser", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = ["sku", "konkurrent", "url", "pris", "status", "fel", "timestamp"];
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow([row.sku, row.competitor, row.url, row.price, row.status, row.error ?? "", row.fetchedAt]);
  }

  formatSheet(sheet);
  sheet.getColumn("D").numFmt = "#,##0.00";
  addAutoFilter(sheet, headers.length, rows.length + 1);
}

function addErrorsSheet(workbook: ExcelJS.Workbook, rows: ScrapedPriceResult[]): void {
  const sheet = workbook.addWorksheet("Fel", { views: [{ state: "frozen", ySplit: 1 }] });
  const errors = rows.filter((row) => row.status === "failed");
  const headers = ["typ", "sku", "url", "fel", "timestamp"];
  sheet.addRow(headers);
  for (const row of errors) {
    sheet.addRow(["scraper", row.sku, row.url, row.error ?? "Okant fel", row.fetchedAt]);
  }

  formatSheet(sheet);
  addAutoFilter(sheet, headers.length, errors.length + 1);
}

function addShopifySheet(workbook: ExcelJS.Workbook, rows: ShopifyUpdateResult[]): void {
  const sheet = workbook.addWorksheet("Shopify", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = ["sku", "shopify_variant_id", "gammalt_pris", "nytt_pris", "status", "fel", "timestamp"];
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow([
      row.sku,
      row.variantId,
      row.oldPrice,
      row.newPrice,
      row.status,
      row.error ?? "",
      row.updatedAt
    ]);
  }

  formatSheet(sheet);
  sheet.getColumn("C").numFmt = "#,##0.00";
  sheet.getColumn("D").numFmt = "#,##0.00";
  addAutoFilter(sheet, headers.length, Math.max(rows.length + 1, 1));
}

function getSheet(workbook: ExcelJS.Workbook, names: string[]): ExcelJS.Worksheet {
  for (const name of names) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) {
      return sheet;
    }
  }

  throw new Error(`Excel saknar flik: ${names.join(" eller ")}`);
}

function readRows(sheet: ExcelJS.Worksheet): RawRow[] {
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];

  headerRow.eachCell((cell, colNumber) => {
    const header = normalizeHeader(cell.value);
    if (header) {
      headers[colNumber] = header;
    }
  });

  const rows: RawRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const obj: RawRow = {};
    let hasValue = false;
    for (let colNumber = 1; colNumber < headers.length; colNumber++) {
      const header = headers[colNumber];
      if (!header) {
        continue;
      }

      const value = normalizeCellValue(row.getCell(colNumber).value);
      obj[header] = value;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        hasValue = true;
      }
    }

    if (hasValue) {
      rows.push(obj);
    }
  });

  return rows;
}

function parseProductRow(row: RawRow): ProductInput {
  const product: ProductInput = {
    sku: requiredString(row.sku, "sku"),
    produktnamn: optionalString(row.produktnamn),
    shopifyProductId: requiredString(row.shopify_product_id, "shopify_product_id"),
    shopifyVariantId: requiredString(row.shopify_variant_id, "shopify_variant_id"),
    inkopspris: requiredNumber(row.inkopspris, "inkopspris"),
    minMarginalProcent: requiredNumber(row.min_marginal_procent, "min_marginal_procent"),
    undercutKr: requiredNumber(row.undercut_kr, "undercut_kr"),
    aktiv: parseBoolean(row.aktiv, true)
  };

  if (product.minMarginalProcent >= 100) {
    throw new Error(`SKU ${product.sku}: min_marginal_procent maste vara under 100.`);
  }

  return product;
}

function parseLinkRow(row: RawRow): LinkInput {
  return {
    sku: requiredString(row.sku, "sku"),
    url: requiredString(row.url, "url"),
    aktiv: parseBoolean(row.aktiv, true)
  };
}

function validateUniqueSkus(products: ProductInput[]): void {
  const seen = new Set<string>();
  for (const product of products) {
    if (seen.has(product.sku)) {
      throw new Error(`Dubblett i Produkter-fliken for SKU: ${product.sku}`);
    }
    seen.add(product.sku);
  }
}

function formatSheet(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  header.alignment = { vertical: "middle", horizontal: "center" };

  sheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  sheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const text = cell.value === null || cell.value === undefined ? "" : String(cell.value);
      maxLength = Math.max(maxLength, Math.min(text.length + 2, 48));
    });
    column.width = maxLength;
  });
}

function addAutoFilter(sheet: ExcelJS.Worksheet, columnCount: number, rowCount: number): void {
  if (rowCount < 1 || columnCount < 1) {
    return;
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(rowCount, 1), column: columnCount }
  };
}

function normalizeHeader(value: ExcelJS.CellValue): string {
  return String(normalizeCellValue(value) ?? "")
    .trim()
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/\s+/g, "_");
}

function normalizeCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("result" in value) {
      return value.result;
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }

  return value;
}

function requiredString(value: unknown, field: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new Error(`Saknar obligatoriskt falt: ${field}`);
  }
  return text;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text ? text : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = parseNumber(value);
  if (parsed === null) {
    throw new Error(`Faltet ${field} maste vara ett nummer.`);
  }
  return parsed;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (YES_VALUES.has(normalized)) {
    return true;
  }
  if (NO_VALUES.has(normalized)) {
    return false;
  }

  return fallback;
}

function isApproved(value: unknown): boolean {
  return parseBoolean(value, false);
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}
