import {
  extractAllSEKPrices,
  extractFirstSEKPrice,
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";

export async function scrapeConrad(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractConradCurrentPrice(html) ??
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Conrad-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractConradCurrentPrice(html: string): number | null {
  const targetedBlocks = [
    extractElementById(html, "productPriceUnitPrice"),
    extractElementByDataE2e(html, "product-price"),
    extractNearbyBlock(html, "productPriceUnitPrice", 1400),
    extractNearbyBlock(html, "product-price", 1400),
    extractNearbyBlock(html, "discounted-price", 1400),
    extractNearbyBlock(html, "priceAvailability", 2500)
  ].filter((value): value is string => Boolean(value));

  for (const block of targetedBlocks) {
    const parsed = extractFirstSEKPrice(stripHtml(block));
    if (parsed !== null) {
      return parsed;
    }
  }

  const buybox = extractNearbyBlock(html, "info-hierarchy-buybox", 8000) ?? extractNearbyBlock(html, "priceAvailability", 8000);
  if (buybox) {
    const prices = extractAllSEKPrices(stripHtml(buybox));
    const plausible = prices.filter((price) => price > 50 && price < 100000);
    if (plausible.length > 0) {
      return Math.min(...plausible);
    }
  }

  return null;
}

function extractElementById(html: string, id: string): string | null {
  const escaped = escapeRegExp(id);
  return html.match(new RegExp(`<([a-z0-9-]+)[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"))?.[2] ?? null;
}

function extractElementByDataE2e(html: string, value: string): string | null {
  const escaped = escapeRegExp(value);
  return html.match(new RegExp(`<([a-z0-9-]+)[^>]+data-e2e=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"))?.[2] ?? null;
}

function extractNearbyBlock(html: string, needle: string, length: number): string | null {
  const index = html.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) {
    return null;
  }

  return html.slice(Math.max(0, index - 500), index + length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
