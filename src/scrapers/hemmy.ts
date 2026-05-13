import {
  extractMetaPrice,
  extractPriceAfterFirstH1,
  extractPriceFromJsonLd,
  fetchHtml,
  stripHtml
} from "./shared.js";
import { parseNumber } from "../money.js";

export async function scrapeHemmy(url: string): Promise<number> {
  const html = await fetchHtml(url);

  const price =
    extractHemmyCurrentPrice(html) ??
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error("Kunde inte hitta huvudpriset pa Hemmy-sidan. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug.");
  }

  return price;
}

function extractHemmyCurrentPrice(html: string): number | null {
  const targetedBlocks = [
    extractByClass(html, "price-big"),
    extractByClass(html, "price"),
    extractNearbyBlock(html, "price-big", 1800),
    extractNearbyBlock(html, "Lagestatus", 3500),
    extractNearbyBlock(html, "Lagerstatus", 3500),
    extractNearbyBlock(html, "Köp", 3500),
    extractNearbyBlock(html, "product", 6000)
  ].filter((value): value is string => Boolean(value));

  for (const block of targetedBlocks) {
    const parsed = extractFirstHemmyPrice(stripHtml(block));
    if (parsed !== null) {
      return parsed;
    }
  }

  return extractFirstHemmyPrice(stripHtml(html));
}

function extractByClass(html: string, className: string): string | null {
  const escaped = escapeRegExp(className);
  const pattern = new RegExp(
    `<([a-z0-9-]+)[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i"
  );

  return html.match(pattern)?.[2] ?? null;
}

function extractNearbyBlock(html: string, needle: string, length: number): string | null {
  const index = html.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) {
    return null;
  }

  return html.slice(Math.max(0, index - 800), index + length);
}

function extractFirstHemmyPrice(text: string): number | null {
  const patterns = [
    /(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{1,2})?|\d{3,})(?:\s*)(?::-|kr\b|sek\b)/i,
    /pris(?:et)?\s*(?:är|:)\s*(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{1,2})?|\d{3,})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = match?.[1] ? parseNumber(match[1]) : null;
    if (parsed !== null && Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
