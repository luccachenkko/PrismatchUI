import {
  extractAllSEKPrices,
  extractFirstSEKPrice,
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";

export async function scrapeFortaltsbutiken(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractFortaltsbutikenCurrentPrice(html) ??
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Fortaltsbutiken-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractFortaltsbutikenCurrentPrice(html: string): number | null {
  const productArea = extractLikelyProductArea(html);
  const sources = [productArea, html].filter((value): value is string => Boolean(value));

  for (const source of sources) {
    const salePrice = extractFromPattern(source, /<ins\b[^>]*>[\s\S]*?<span[^>]+class=["'][^"']*(?:woocommerce-Price-amount|amount|price)[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/ins>/i);
    if (salePrice !== null) {
      return salePrice;
    }

    const priceBlock = source.match(/<p[^>]+class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (priceBlock) {
      const withoutOld = removeOldPrices(priceBlock);
      const parsed = extractFirstSEKPrice(stripHtml(withoutOld));
      if (parsed !== null) {
        return parsed;
      }
    }

    const amountPrice = extractFromPattern(source, /<span[^>]+class=["'][^"']*(?:woocommerce-Price-amount|amount|product-price|price)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if (amountPrice !== null) {
      return amountPrice;
    }

    const dataPrice = extractFromPattern(source, /data-(?:price|product-price|sale-price)=["']([^"']+)["']/i);
    if (dataPrice !== null) {
      return dataPrice;
    }
  }

  const prices = extractAllSEKPrices(stripHtml(productArea ?? html)).filter((price) => price > 0 && price < 100000);
  return prices.length > 0 ? prices[0] : null;
}

function extractFromPattern(source: string, pattern: RegExp): number | null {
  const match = source.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  return extractFirstSEKPrice(stripHtml(`${match[1]} kr`));
}

function extractLikelyProductArea(html: string): string | null {
  const selectors = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+class=["'][^"']*(?:product-summary|summary|product-info|product-page|productView|product-single)[^"']*["'][^>]*>([\s\S]{0,12000})<\/div>/i,
    /<section[^>]+class=["'][^"']*(?:product|product-page|product-info)[^"']*["'][^>]*>([\s\S]{0,15000})<\/section>/i,
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

function removeOldPrices(html: string): string {
  return html
    .replace(/<del\b[\s\S]*?<\/del>/gi, " ")
    .replace(/<s\b[\s\S]*?<\/s>/gi, " ")
    .replace(/class=["'][^"']*(?:old|regular|compare|was)[^"']*["'][\s\S]*?<\/[^>]+>/gi, " ");
}
