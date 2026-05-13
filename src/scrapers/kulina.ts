import {
  extractFirstSEKPrice,
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";

export async function scrapeKulina(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractKulinaCurrentPrice(html) ??
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Kulina-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractKulinaCurrentPrice(html: string): number | null {
  const patterns = [
    /<strong[^>]+data-testid=["']productCardPrice["'][^>]*>([\s\S]*?)<\/strong>/i,
    /<span[^>]+class=["'][^"']*price-final-holder[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<[^>]+class=["'][^"']*price-final[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parsed = extractFirstSEKPrice(stripHtml(match[1]));
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}
