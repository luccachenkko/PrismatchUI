import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNumber } from "../money.js";

export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
      "cache-control": "no-cache"
    }
  });

  const html = await response.text();

  if (isScraperDebugEnabled()) {
    await saveScraperDebugFile(url, html, response.status).catch(() => undefined);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return html;
}

export function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
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

export function extractAllSEKPrices(text: string): number[] {
  const prices: number[] = [];
  const matches = text.matchAll(/(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{1,2})?|\d{3,})(?:\s*)kr\b/gi);

  for (const match of matches) {
    const parsed = match[1] ? parseNumber(match[1]) : null;
    if (parsed !== null && Number.isFinite(parsed)) {
      prices.push(parsed);
    }
  }

  return prices;
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

export function isScraperDebugEnabled(): boolean {
  return ["1", "true", "yes", "ja"].includes((process.env.SCRAPER_DEBUG ?? "").toLowerCase());
}

async function saveScraperDebugFile(url: string, html: string, statusCode: number): Promise<void> {
  const domain = domainFromUrl(url);
  const dir = join(process.cwd(), "output", "scraper-debug");
  await mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeDomain = domain.replace(/[^a-z0-9.-]/gi, "_");
  const baseName = `${timestamp}_${safeDomain}_${statusCode}`;

  await writeFile(join(dir, `${baseName}.html`), html, "utf8");
  await writeFile(
    join(dir, `${baseName}.txt`),
    [
      `url=${url}`,
      `domain=${domain}`,
      `http_status=${statusCode}`,
      `html_length=${html.length}`,
      "",
      "price_like_matches=",
      ...extractAllSEKPrices(stripHtml(html)).slice(0, 30).map((price) => String(price))
    ].join("\n"),
    "utf8"
  );
}
