import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

type RawRow = Record<string, string>;

const DELIMITER = ";";
const YES_VALUES = new Set(["ja", "yes", "true", "1", "x", "y"]);
const NO_VALUES = new Set(["nej", "no", "false", "0", "n"]);

export async function readInputCsvFiles(params: {
  productsPath: string;
  linksPath: string;
}): Promise<{ products: ProductInput[]; links: LinkInput[] }> {
  const [productRows, linkRows] = await Promise.all([
    readCsvFile(params.productsPath),
    readCsvFile(params.linksPath)
  ]);

  const products = productRows.map(parseProductRow).filter((row) => row.aktiv);
  const links = linkRows.map(parseLinkRow).filter((row) => row.aktiv);

  validateUniqueSkus(products);
  validateLinksHaveProducts(products, links);

  return { products, links };
}

export async function writePriceReports(params: {
  outputDir: string;
  recommendations: Recommendation[];
  scrapedPrices: ScrapedPriceResult[];
  updateResults?: ShopifyUpdateResult[];
}): Promise<void> {
  await mkdir(params.outputDir, { recursive: true });
  await removeOldOutputFiles(params.outputDir);

  const scrapedSummaryBySku = buildScrapedSummaryBySku(params.scrapedPrices);

  await writeCsvFile(
    path.join(params.outputDir, "prisrapport.csv"),
    recommendationHeaders(),
    params.recommendations.map((recommendation) => {
      const summary = scrapedSummaryBySku.get(recommendation.sku) ?? { prices: "", errors: "" };
      return {
        ...recommendationToRow(recommendation),
        hamtade_priser: summary.prices,
        prishamtningsfel: summary.errors
      };
    })
  );
}

export async function readApprovedUpdates(recommendationsPath: string): Promise<ShopifyUpdateRequest[]> {
  const rows = await readCsvFile(recommendationsPath);

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

export async function writeShopifyUpdateResults(
  filePath: string,
  updateResults: ShopifyUpdateResult[]
): Promise<void> {
  await rm(path.join(path.dirname(filePath), "shopify_uppdateringar.csv"), { force: true });
  await writeCsvFile(filePath, shopifyUpdateHeaders(), updateResults.map(shopifyUpdateToRow));
}

async function readCsvFile(filePath: string): Promise<RawRow[]> {
  const text = await readFile(filePath, "utf8");
  return parseCsv(text);
}

async function writeCsvFile(filePath: string, headers: string[], rows: RawRow[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = serializeCsv(headers, rows);
  await writeFile(filePath, content, "utf8");
}

async function removeOldOutputFiles(outputDir: string): Promise<void> {
  await Promise.all(
    [
      "rekommendationer.csv",
      "hamtade_priser.csv",
      "fel.csv",
      "shopify_uppdateringar.csv",
      "report.json"
    ].map((fileName) => rm(path.join(outputDir, fileName), { force: true }))
  );
}

function buildScrapedSummaryBySku(rows: ScrapedPriceResult[]): Map<string, { prices: string; errors: string }> {
  const grouped = new Map<string, { priceParts: string[]; errorParts: string[] }>();

  for (const row of rows) {
    const existing = grouped.get(row.sku) ?? { priceParts: [], errorParts: [] };
    const source = row.competitor || getDomainFromUrl(row.url);

    if (row.status === "success" && typeof row.price === "number") {
      existing.priceParts.push(`${source}: ${row.price} kr`);
    } else {
      existing.errorParts.push(`${source}: ${row.error ?? "Okant fel"}`);
    }

    grouped.set(row.sku, existing);
  }

  const result = new Map<string, { prices: string; errors: string }>();
  for (const [sku, value] of grouped.entries()) {
    result.set(sku, {
      prices: value.priceParts.join(" | "),
      errors: value.errorParts.join(" | ")
    });
  }

  return result;
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function parseCsv(text: string): RawRow[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === DELIMITER && !inQuotes) {
      currentRecord.push(currentField);
      currentField = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      currentRecord.push(currentField);
      records.push(currentRecord);
      currentRecord = [];
      currentField = "";
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField);
    records.push(currentRecord);
  }

  const nonEmptyRecords = records.filter((record) => record.some((field) => field.trim() !== ""));
  if (nonEmptyRecords.length === 0) {
    return [];
  }

  const headers = nonEmptyRecords[0].map(normalizeHeader);
  const rows: RawRow[] = [];

  for (const record of nonEmptyRecords.slice(1)) {
    const row: RawRow = {};
    let hasValue = false;

    for (let index = 0; index < headers.length; index++) {
      const header = headers[index];
      if (!header) {
        continue;
      }
      const value = (record[index] ?? "").trim();
      row[header] = value;
      if (value !== "") {
        hasValue = true;
      }
    }

    if (hasValue) {
      rows.push(row);
    }
  }

  return rows;
}

function serializeCsv(headers: string[], rows: RawRow[]): string {
  const lines = [
    headers.map(escapeCsvField).join(DELIMITER),
    ...rows.map((row) => headers.map((header) => escapeCsvField(row[header] ?? "")).join(DELIMITER))
  ];

  return `${lines.join("\n")}\n`;
}

function escapeCsvField(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseProductRow(row: RawRow): ProductInput {
  const product: ProductInput = {
    sku: requiredString(row.sku, "sku"),
    produktnamn: optionalString(row.produktnamn),
    shopifyProductId: normalizeShopifyGid(requiredString(row.shopify_product_id, "shopify_product_id"), "Product"),
    shopifyVariantId: normalizeShopifyGid(requiredString(row.shopify_variant_id, "shopify_variant_id"), "ProductVariant"),
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
      throw new Error(`Dubblett i produkter.csv for SKU: ${product.sku}`);
    }
    seen.add(product.sku);
  }
}

function validateLinksHaveProducts(products: ProductInput[], links: LinkInput[]): void {
  const productSkus = new Set(products.map((product) => product.sku));
  const missing = [...new Set(links.map((link) => link.sku).filter((sku) => !productSkus.has(sku)))];

  if (missing.length > 0) {
    throw new Error(`lankar.csv innehaller SKU utan aktiv produkt i produkter.csv: ${missing.join(", ")}`);
  }
}

function normalizeShopifyGid(value: string, type: "Product" | "ProductVariant"): string {
  if (value.startsWith("gid://shopify/")) {
    return value;
  }

  if (/^\d+$/.test(value)) {
    return `gid://shopify/${type}/${value}`;
  }

  return value;
}

function recommendationHeaders(): string[] {
  return [
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
    "hamtade_priser",
    "prishamtningsfel",
    "godkand",
    "shopify_product_id",
    "shopify_variant_id",
    "timestamp"
  ];
}

function recommendationToRow(row: Recommendation): RawRow {
  return {
    sku: row.sku,
    produktnamn: row.produktnamn,
    shopify_lager: formatValue(row.shopifyLager),
    shopify_pris_nu: formatValue(row.shopifyPrisNu),
    billigaste_konkurrent: formatValue(row.billigasteKonkurrent),
    billigaste_url: formatValue(row.billigasteUrl),
    billigaste_konkurrentpris: formatValue(row.billigasteKonkurrentpris),
    foreslaget_pris: formatValue(row.foreslagetPris),
    inkopspris: formatValue(row.inkopspris),
    marginal_efter_procent: formatValue(row.marginalEfterProcent),
    minsta_tillatna_pris: formatValue(row.minstaTillatnaPris),
    prisandring_kr: formatValue(row.prisandringKr),
    prisandring_procent: formatValue(row.prisandringProcent),
    status: row.status,
    orsak: row.orsak,
    godkand: row.godkand,
    shopify_product_id: row.shopifyProductId,
    shopify_variant_id: row.shopifyVariantId,
    timestamp: row.timestamp
  };
}

function scrapedPriceHeaders(): string[] {
  return ["sku", "konkurrent", "url", "pris", "status", "fel", "timestamp"];
}

function scrapedPriceToRow(row: ScrapedPriceResult): RawRow {
  return {
    sku: row.sku,
    konkurrent: row.competitor,
    url: row.url,
    pris: formatValue(row.price),
    status: row.status,
    fel: row.error ?? "",
    timestamp: row.fetchedAt
  };
}

function errorHeaders(): string[] {
  return ["typ", "sku", "url", "fel", "timestamp"];
}

function scrapedErrorToRow(row: ScrapedPriceResult): RawRow {
  return {
    typ: "scraper",
    sku: row.sku,
    url: row.url,
    fel: row.error ?? "Okant fel",
    timestamp: row.fetchedAt
  };
}

function shopifyUpdateHeaders(): string[] {
  return ["sku", "shopify_variant_id", "gammalt_pris", "nytt_pris", "status", "fel", "timestamp"];
}

function shopifyUpdateToRow(row: ShopifyUpdateResult): RawRow {
  return {
    sku: row.sku,
    shopify_variant_id: row.variantId,
    gammalt_pris: formatValue(row.oldPrice),
    nytt_pris: formatValue(row.newPrice),
    status: row.status,
    fel: row.error ?? "",
    timestamp: row.updatedAt
  };
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/\s+/g, "_");
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
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
  return YES_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function formatValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return value;
}
