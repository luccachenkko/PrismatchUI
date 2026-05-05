import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "./env.js";
import { readApprovedUpdates, writeShopifyUpdateResults } from "./csv.js";
import { formatSEK } from "./money.js";
import { ProgressBar } from "./progress.js";
import { updateShopifyPrices } from "./shopify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const recommendationsPath = path.join(projectRoot, "output", "prisrapport.csv");
const shopifyUpdatesPath = path.join(projectRoot, "output", "shopify_resultat.csv");

async function main(): Promise<void> {
  loadDotEnv(path.join(projectRoot, ".env"));

  console.log(`Laser godkanda rader fran: ${recommendationsPath}`);
  const updates = await readApprovedUpdates(recommendationsPath);

  if (updates.length === 0) {
    console.log("Inga godkanda OK-rader hittades. Skriv ja i kolumnen godkand i output/prisrapport.csv.");
    return;
  }

  console.log(`Godkanda Shopify-uppdateringar: ${updates.length}`);
  for (const update of updates) {
    console.log(`${update.sku}: ${formatSEK(update.oldPrice)} -> ${formatSEK(update.newPrice)}`);
  }

  const progress = new ProgressBar({ label: "Shopify", total: updates.length });
  progress.start();

  let results;
  try {
    results = await updateShopifyPrices(updates, {
      onProgress: () => {
        progress.tick();
      }
    });
    progress.finish("Shopify-uppdatering klar.");
  } catch (error) {
    progress.fail("avbruten");
    throw error;
  }

  await writeShopifyUpdateResults(shopifyUpdatesPath, results);

  const updatedCount = results.filter((row) => row.status === "updated").length;
  const failedCount = results.filter((row) => row.status === "failed").length;

  console.log(`Uppdaterade: ${updatedCount}`);
  console.log(`Misslyckade: ${failedCount}`);
  console.log(`Shopify-resultat sparat i: ${shopifyUpdatesPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fel: ${message}`);
  process.exitCode = 1;
});
