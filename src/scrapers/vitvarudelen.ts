import {
  extractAllSEKPrices,
  extractFirstSEKPrice,
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";
import { parseNumber } from "../money.js";

export async function scrapeVitvarudelen(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractShopifyVariantPrice(html) ??
    extractVitvarudelenCurrentPrice(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Vitvarudelen-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractVitvarudelenCurrentPrice(html: string): number | null {
  const productArea = extractLikelyProductArea(html);
  const sources = [productArea, html].filter((value): value is string => Boolean(value));

  const pricePatterns = [
    /<sale-price\b[^>]*>([\s\S]*?)<\/sale-price>/i,
    /<span[^>]+class=["'][^"']*(?:price-item--sale|price-item--regular|product__price|product-price|price__current|price)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]+class=["'][^"']*(?:price__sale|price__regular|product__price|product-price|price)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]+class=["'][^"']*(?:price|product-price)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i
  ];

  for (const source of sources) {
    for (const pattern of pricePatterns) {
      const match = source.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const parsed = extractFirstSEKPrice(stripHtml(removeCompareAtPrices(match[1])));
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  const text = stripHtml(productArea ?? html);
  const prices = extractAllSEKPrices(text).filter((price) => price > 0 && price < 100000);
  return prices.length > 0 ? prices[0] : null;
}

function extractShopifyVariantPrice(html: string): number | null {
  const variantPricePatterns = [
    /"price"\s*:\s*(\d{3,8})\s*,\s*"compare_at_price"/i,
    /"price"\s*:\s*(\d{3,8})\s*,\s*"available"/i,
    /"price"\s*:\s*(\d{3,8})\s*,\s*"featured_image"/i
  ];

  for (const pattern of variantPricePatterns) {
    const match = html.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parsed = parseNumber(match[1]);
    if (parsed !== null) {
      return parsed > 10000 ? parsed / 100 : parsed;
    }
  }

  return null;
}

function extractLikelyProductArea(html: string): string | null {
  const selectors = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<section[^>]+id=["'][^"']*MainProduct[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
    /<product-info\b[^>]*>([\s\S]*?)<\/product-info>/i,
    /<div[^>]+class=["'][^"']*(?:product__info|product-info|product-single|product-page)[^"']*["'][^>]*>([\s\S]{0,12000})<\/div>/i,
    /<h1\b[^>]*>[\s\S]*?<\/h1>([\s\S]{0,7000})/i
  ];

  for (const pattern of selectors) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function removeCompareAtPrices(html: string): string {
  return html
    .replace(/<s\b[\s\S]*?<\/s>/gi, " ")
    .replace(/<del\b[\s\S]*?<\/del>/gi, " ")
    .replace(/class=["'][^"']*(?:compare|was|old)[^"']*["'][\s\S]*?<\/[^>]+>/gi, " ");
}
