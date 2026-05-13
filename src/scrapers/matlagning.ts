import {
  extractFirstSEKPrice,
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";

export async function scrapeMatlagning(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractMatlagningCurrentPrice(html) ??
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Matlagning-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractMatlagningCurrentPrice(html: string): number | null {
  const productArea = extractLikelyProductArea(html);

  for (const source of [productArea, html]) {
    if (!source) {
      continue;
    }

    const salePrice = extractFromPattern(
      source,
      /<ins\b[^>]*>[\s\S]*?<span[^>]+class=["'][^"']*woocommerce-Price-amount[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/ins>/i
    );
    if (salePrice !== null) {
      return salePrice;
    }

    const priceBlock = source.match(/<p[^>]+class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (priceBlock) {
      const priceBlockWithoutOldPrice = priceBlock.replace(/<del\b[\s\S]*?<\/del>/gi, " ");
      const parsed = extractFirstSEKPrice(stripHtml(priceBlockWithoutOldPrice));
      if (parsed !== null) {
        return parsed;
      }
    }

    const amountPrice = extractFromPattern(
      source,
      /<span[^>]+class=["'][^"']*woocommerce-Price-amount[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    );
    if (amountPrice !== null) {
      return amountPrice;
    }

    const bdiPrice = extractFromPattern(source, /<bdi[^>]*>([\s\S]*?)<\/bdi>/i);
    if (bdiPrice !== null) {
      return bdiPrice;
    }
  }

  return null;
}

function extractFromPattern(source: string, pattern: RegExp): number | null {
  const match = source.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  return extractFirstSEKPrice(stripHtml(match[1]));
}

function extractLikelyProductArea(html: string): string | null {
  const summary = html.match(/<div[^>]+class=["'][^"']*\bsummary\b[^"']*["'][^>]*>([\s\S]{0,6000})<\/div>/i)?.[1];
  if (summary) {
    return summary;
  }

  const afterH1 = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>([\s\S]{0,6000})/i)?.[1];
  if (afterH1) {
    return afterH1;
  }

  const product = html.match(/<div[^>]+class=["'][^"']*\bproduct\b[^"']*["'][^>]*>([\s\S]{0,10000})<\/div>/i)?.[1];
  return product ?? null;
}
