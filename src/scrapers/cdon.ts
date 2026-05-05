import { extractMetaPrice, extractPriceAfterFirstH1, extractPriceFromJsonLd, fetchHtml } from "./shared.js";

export async function scrapeCdon(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price = extractPriceAfterFirstH1(html) ?? extractMetaPrice(html) ?? extractPriceFromJsonLd(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa CDON-sidan.");
  }

  return price;
}
