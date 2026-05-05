import { parseNumber } from "../money.js";

export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; ShopifyPriceMatcher/0.2; price monitoring for own store)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

export function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function extractJsonLdProductText(html: string): string | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const block of blocks) {
    const text = decodeHtml(block[1]).trim();
    if (!text || !/@type/i.test(text) || !/Product/i.test(text)) {
      continue;
    }

    return text;
  }

  return null;
}

export function extractPriceFromJsonLd(html: string): number | null {
  const jsonText = extractJsonLdProductText(html);
  if (!jsonText) {
    return null;
  }

  const patterns = [
    /"price"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i,
    /"lowPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/i
  ];

  for (const pattern of patterns) {
    const match = jsonText.match(pattern);
    const parsed = match?.[1] ? parseNumber(match[1]) : null;
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function extractPriceAfterFirstH1(html: string): number | null {
  const afterH1 = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>([\s\S]{0,3500})/i)?.[1];
  if (!afterH1) {
    return null;
  }

  return extractFirstSEKPrice(stripHtml(afterH1));
}

export function extractFirstSEKPrice(text: string): number | null {
  const match = text.match(/(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{1,2})?|\d{3,})(?:\s*)kr\b/i);
  return match?.[1] ? parseNumber(match[1]) : null;
}

export function extractMetaPrice(html: string): number | null {
  const patterns = [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["'][^>]*>/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']price["'][^>]*>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const parsed = match?.[1] ? parseNumber(match[1]) : null;
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function domainFromUrl(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}
