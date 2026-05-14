import {
  extractAllSEKPrices,
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";

export async function scrapeBygghemma(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractBygghemmaBuyBoxPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractMetaPrice(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Bygghemma-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractBygghemmaBuyBoxPrice(html: string): number | null {
  const text = stripHtml(html);
  const markers = ["Matcha priset", "Lägg i varukorg", "Lagg i varukorg"];

  for (const marker of markers) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index === -1) {
      continue;
    }

    const beforeMarker = text.slice(Math.max(0, index - 600), index);
    const prices = extractAllSEKPrices(beforeMarker).filter((price) => price > 0);
    const price = prices.at(-1);
    if (price !== undefined) {
      return price;
    }
  }

  return null;
}
