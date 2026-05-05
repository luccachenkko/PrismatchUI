import path from "node:path";
import { fileURLToPath } from "node:url";

import { mapWithConcurrency } from "./concurrency.js";
import { loadDotEnv, getEnvNumber } from "./env.js";
import { readInputCsvFiles, writePriceReports } from "./csv.js";
import { ProgressBar } from "./progress.js";
import { calculateRecommendation } from "./rules.js";
import { scrapePriceForLink } from "./scrapers/index.js";
import { fetchShopifyVariantStates } from "./shopify.js";
import type { LinkInput, Recommendation, ScrapedPriceResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const productsPath = path.join(projectRoot, "input", "produkter.csv");
const linksPath = path.join(projectRoot, "input", "lankar.csv");
const outputDir = path.join(projectRoot, "output");
const mainReportPath = path.join(outputDir, "prisrapport.csv");

async function main(): Promise<void> {
  loadDotEnv(path.join(projectRoot, ".env"));

  console.log("Startar batch-prismatchning.");
  console.log(`Laser produkter: ${productsPath}`);
  console.log(`Laser lankar: ${linksPath}`);

  const { products, links } = await readInputCsvFiles({ productsPath, linksPath });
  console.log(`Aktiva produkter: ${products.length}`);
  console.log(`Aktiva lankar: ${links.length}`);

  const linksBySku = groupLinksBySku(links);

  console.log("Hamtar Shopify-pris och eget Shopify-lager...");
  const shopifyStates = await fetchShopifyVariantStates(products);

  const activeSkusWithStock = new Set<string>();
  const shopifyErrors = new Map<string, string>();

  for (const product of products) {
    const state = shopifyStates.get(product.sku);
    if (!state) {
      shopifyErrors.set(product.sku, "Shopify returnerade ingen variant for angivet shopify_variant_id.");
      continue;
    }

    if (state.inventoryQuantity > 0) {
      activeSkusWithStock.add(product.sku);
    }
  }

  const skippedByStock = products.length - activeSkusWithStock.size - shopifyErrors.size;
  console.log(`Produkter med eget lager > 0: ${activeSkusWithStock.size}`);
  console.log(`Produkter skippade pga eget lager 0: ${Math.max(0, skippedByStock)}`);
  if (shopifyErrors.size > 0) {
    console.log(`Produkter med Shopify-fel: ${shopifyErrors.size}`);
  }

  const priceJobs: LinkInput[] = [];
  for (const product of products) {
    if (!activeSkusWithStock.has(product.sku)) {
      continue;
    }
    priceJobs.push(...(linksBySku.get(product.sku) ?? []));
  }

  console.log(`Lankar som ska hamtas efter lagerfilter: ${priceJobs.length}`);
  const concurrency = getEnvNumber("PRICE_FETCH_CONCURRENCY", 10);
  console.log(`Hamtar konkurrentpriser med max ${concurrency} jobb samtidigt.`);

  let scrapedPrices: ScrapedPriceResult[] = [];
  if (priceJobs.length > 0) {
    const progress = new ProgressBar({ label: "Prishamtning", total: priceJobs.length });
    progress.start();

    try {
      scrapedPrices = await mapWithConcurrency(priceJobs, concurrency, async (link) => {
        const result = await scrapePriceForLink(link);
        progress.tick();
        return result;
      });
      progress.finish("Prishamtning klar.");
    } catch (error) {
      progress.fail("avbruten");
      throw error;
    }
  }

  const scrapedBySku = groupScrapedPricesBySku(scrapedPrices);
  const recommendations = products.map((product) =>
    calculateRecommendation({
      product,
      shopifyState: shopifyStates.get(product.sku) ?? null,
      shopifyError: shopifyErrors.get(product.sku),
      scrapedPrices: scrapedBySku.get(product.sku) ?? []
    })
  );

  await writePriceReports({
    outputDir,
    recommendations,
    scrapedPrices
  });

  printSummary(recommendations, scrapedPrices);

  console.log(`Rapport skapad: ${mainReportPath}`);
  console.log("Skriv ja i kolumnen godkand pa rader du vill uppdatera och kor sedan: npm run apply-approved");
}

function printSummary(recommendations: Recommendation[], scrapedPrices: ScrapedPriceResult[]): void {
  const okCount = recommendations.filter((row) => row.status === "OK").length;
  const noChangeCount = recommendations.filter((row) => row.status === "INGEN_ANDRING").length;
  const skippedStockCount = recommendations.filter((row) => row.status === "SKIPPAD_EGET_LAGER_0").length;
  const blockedRows = recommendations.filter((row) => row.status.startsWith("BLOCKERAD"));
  const priceErrorCount = scrapedPrices.filter((row) => row.status === "failed").length;

  console.log("Klar.");
  console.log(`OK for godkannande: ${okCount}`);
  console.log(`Ingen andring behovs: ${noChangeCount}`);
  console.log(`Skippade pga eget lager 0: ${skippedStockCount}`);
  console.log(`Blockerade av regler: ${blockedRows.length}`);
  console.log(`Prishamtningsfel: ${priceErrorCount}`);

  if (blockedRows.length > 0) {
    console.log("Blockerade rader och anledning:");
    for (const row of blockedRows.slice(0, 25)) {
      console.log(`- ${row.sku}: ${row.status} - ${row.orsak}`);
      if (row.shopifyPrisNu !== null && row.foreslagetPris !== null) {
        console.log(
          `  Shopify nu: ${row.shopifyPrisNu} kr | foreslaget: ${row.foreslagetPris} kr | andring: ${row.prisandringProcent ?? ""}%`
        );
      }
    }
    if (blockedRows.length > 25) {
      console.log(`... plus ${blockedRows.length - 25} till. Se kolumnen orsak i output/prisrapport.csv.`);
    }
  }
}

function groupLinksBySku(links: LinkInput[]): Map<string, LinkInput[]> {
  const grouped = new Map<string, LinkInput[]>();
  for (const link of links) {
    const existing = grouped.get(link.sku) ?? [];
    existing.push(link);
    grouped.set(link.sku, existing);
  }
  return grouped;
}

function groupScrapedPricesBySku(rows: ScrapedPriceResult[]): Map<string, ScrapedPriceResult[]> {
  const grouped = new Map<string, ScrapedPriceResult[]>();
  for (const row of rows) {
    const existing = grouped.get(row.sku) ?? [];
    existing.push(row);
    grouped.set(row.sku, existing);
  }
  return grouped;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fel: ${message}`);
  process.exitCode = 1;
});
