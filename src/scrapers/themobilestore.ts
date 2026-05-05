import { extractFirstSEKPrice, extractPriceAfterFirstH1, fetchHtml, stripHtml } from "./shared.js";

export async function scrapeTheMobileStore(url: string): Promise<number> {
  const html = await fetchHtml(url);
  const text = stripHtml(html);

  const saleMatch = text.match(/rea pris\s+(\d{1,3}(?:[\s\u00a0]\d{3})*|\d+)\s*kr/i);
  const salePrice = saleMatch?.[1] ? extractFirstSEKPrice(`${saleMatch[1]} kr`) : null;

  const price = salePrice ?? extractPriceAfterFirstH1(html) ?? extractFirstSEKPrice(text);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa TheMobileStore-sidan.");
  }

  return price;
}
