import { parseNumber } from "../money.js";
import {
  extractAllSEKPrices,
  extractFirstSEKPrice,
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";

export async function scrapeKokochmer(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractShopifyVariantPrice(html) ??
    extractKokochmerBuyAreaPrice(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Kok & Mer-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractShopifyVariantPrice(html: string): number | null {
  const variantBlocks = [
    ...html.matchAll(/"variants"\s*:\s*\[([\s\S]{0,12000}?)\]/gi),
    ...html.matchAll(/variants\s*:\s*\[([\s\S]{0,12000}?)\]/gi)
  ];

  for (const block of variantBlocks) {
    const price = extractCentsPriceFromText(block[1]);
    if (price !== null) {
      return price;
    }
  }

  return null;
}

function extractCentsPriceFromText(text: string): number | null {
  const patterns = [
    /"price"\s*:\s*(\d{3,})/i,
    /\bprice\s*:\s*(\d{3,})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const rawPrice = match?.[1] ? Number.parseInt(match[1], 10) : NaN;

    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      continue;
    }

    return rawPrice >= 10000 ? rawPrice / 100 : rawPrice;
  }

  return null;
}

function extractKokochmerBuyAreaPrice(html: string): number | null {
  const text = stripHtml(html);
  const markers = ["Lagg i varukorg", "L\u00e4gg i varukorg", "Kop nu", "K\u00f6p nu"];

  for (const marker of markers) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index === -1) {
      continue;
    }

    const beforeMarker = text.slice(Math.max(0, index - 900), index);
    const prices = extractAllSEKPrices(beforeMarker).filter((price) => price > 0);
    const price = prices.at(-1);
    if (price !== undefined) {
      return price;
    }
  }

  const priceJson = extractPriceFromRenderedJson(text);
  if (priceJson !== null) {
    return priceJson;
  }

  return extractFirstSEKPrice(text);
}

function extractPriceFromRenderedJson(text: string): number | null {
  const patterns = [
    /(?:price|amount)["']?\s*[:=]\s*["']?(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{1,2})?|\d{3,})["']?/i,
    /pris(?:et)?\s*(?:ar|\u00e4r|:)\s*(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{1,2})?|\d{3,})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = match?.[1] ? parseNumber(match[1]) : null;
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }

  return null;
}
