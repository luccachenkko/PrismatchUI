import {
  extractFirstSEKPrice,
  extractJsonLdProductText,
  extractMetaPrice,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";

export async function scrapeHemmabutiken(url: string): Promise<number> {
  const html = await fetchHtml(url);
  const mainProductHtml = extractMainProductHtml(html);

  const price =
    extractPriceFromJsonLd(mainProductHtml) ??
    extractMetaPrice(mainProductHtml) ??
    extractFirstSEKPrice(stripHtml(mainProductHtml));

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Hemmabutiken-sidan.");
  }

  return price;
}

function extractMainProductHtml(html: string): string {
  const jsonLdProduct = extractJsonLdProductText(html);
  if (jsonLdProduct) {
    return jsonLdProduct;
  }

  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const mainHtml = mainMatch?.[1] ?? html;

  const stopMarkers = [
    /rekommenderade produkter/i,
    /relaterade produkter/i,
    /du kanske (?:ocksa|också) gillar/i,
    /<section\b[^>]*(?:recommend|related|upsell|cross-sell)[^>]*>/i,
    /<div\b[^>]*(?:recommend|related|upsell|cross-sell)[^>]*>/i
  ];

  let endIndex = mainHtml.length;
  for (const marker of stopMarkers) {
    const match = marker.exec(mainHtml);
    if (match && match.index < endIndex) {
      endIndex = match.index;
    }
  }

  return mainHtml.slice(0, endIndex);
}
