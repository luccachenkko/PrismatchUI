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

const PRODUCT_API_URL = "https://wytcracosrlawpzfvqbs.supabase.co/functions/v1/get-magento-product-by-url-key";

export async function scrapeSkrotahusvagn(url: string): Promise<number> {
  const urlKey = extractUrlKey(url);

  if (urlKey) {
    const apiPrice = await scrapeSkrotahusvagnApi(urlKey).catch((error: unknown) => {
      if (process.env.SCRAPER_DEBUG) {
        console.warn(`[skrotahusvagn] API-prishamtning misslyckades for ${urlKey}:`, error);
      }
      return null;
    });

    if (apiPrice !== null) {
      return apiPrice;
    }
  }

  // Fallback: fungerar om sidan nagon gang borjar rendera pris i server-HTML.
  const html = await fetchHtml(url);

  const price =
    extractSkrotahusvagnCurrentPrice(html) ??
    extractMetaPrice(html) ??
    extractPriceFromJsonLd(html) ??
    extractPriceAfterFirstH1(html);

  if (price === null) {
    throw new Error(
      "Kunde inte hitta huvudpriset pa SkrotaHusvagn-sidan. API-prishamtning misslyckades och server-HTML inneholl inget pris. Satt SCRAPER_DEBUG=true och kor igen for att spara HTML i output/scraper-debug."
    );
  }

  return price;
}

function extractUrlKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    const last = parts.at(-1);
    return last ? decodeURIComponent(last).replace(/\/+$/g, "") : null;
  } catch {
    return null;
  }
}

async function scrapeSkrotahusvagnApi(urlKey: string): Promise<number | null> {
  const payloads: Array<Record<string, unknown>> = [
    { url_key: urlKey },
    { urlKey },
    { key: urlKey },
    { url_key: urlKey, store_view: "sv" },
    { urlKey, storeView: "sv" }
  ];

  let lastError: string | null = null;

  for (const payload of payloads) {
    const result = await fetchSkrotahusvagnApiPayload(payload).catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error);
      return null;
    });

    const price = extractPriceFromApiResponse(result);
    if (price !== null) {
      return price;
    }
  }

  // Some endpoints are implemented as query endpoints instead of POST body endpoints.
  const queryVariants = [
    `${PRODUCT_API_URL}?url_key=${encodeURIComponent(urlKey)}`,
    `${PRODUCT_API_URL}?urlKey=${encodeURIComponent(urlKey)}`,
    `${PRODUCT_API_URL}?key=${encodeURIComponent(urlKey)}`
  ];

  for (const apiUrl of queryVariants) {
    const result = await fetchSkrotahusvagnApiUrl(apiUrl).catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error);
      return null;
    });

    const price = extractPriceFromApiResponse(result);
    if (price !== null) {
      return price;
    }
  }

  if (lastError && process.env.SCRAPER_DEBUG) {
    console.warn(`[skrotahusvagn] Ingen API-variant gav pris. Senaste fel: ${lastError}`);
  }

  return null;
}

async function fetchSkrotahusvagnApiPayload(payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(PRODUCT_API_URL, {
    method: "POST",
    headers: buildApiHeaders(),
    body: JSON.stringify(payload)
  });

  return readJsonResponse(response);
}

async function fetchSkrotahusvagnApiUrl(apiUrl: string): Promise<unknown> {
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: buildApiHeaders()
  });

  return readJsonResponse(response);
}

function buildApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://skrotahusvagn.com",
    referer: "https://skrotahusvagn.com/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  // If Supabase JWT verification is enabled later, add the public anon key in .env.
  // Do NOT put this key in frontend code. This scraper runs on backend only.
  const anonKey = process.env.SKROTAHUSVAGN_SUPABASE_ANON_KEY?.trim();
  if (anonKey) {
    headers.apikey = anonKey;
    headers.authorization = `Bearer ${anonKey}`;
  }

  return headers;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API-svaret var inte JSON: ${text.slice(0, 300)}`);
  }
}

function extractPriceFromApiResponse(value: unknown): number | null {
  const data = unwrapApiData(value);
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const price = numberFromUnknown(record.price);
  const specialPrice = numberFromUnknown(record.special_price);

  if (specialPrice !== null && specialPrice > 0 && price !== null && specialPrice < price) {
    return specialPrice;
  }

  if (specialPrice !== null && specialPrice > 0 && price === null) {
    return specialPrice;
  }

  return price !== null && price > 0 ? price : null;
}

function unwrapApiData(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;

  if (record.success === false) {
    return null;
  }

  if (record.data !== undefined) {
    return record.data;
  }

  return value;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    return parseNumber(value);
  }

  return null;
}

function extractSkrotahusvagnCurrentPrice(html: string): number | null {
  const productArea = extractLikelyProductArea(html);
  const sources = [productArea, html].filter((value): value is string => Boolean(value));

  const pricePatterns = [
    /<[^>]+class=["'][^"']*(?:product-price|price-current|current-price|price__current|price|amount)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<[^>]+id=["'][^"']*(?:product-price|price)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]+itemprop=["']price["']/i
  ];

  for (const source of sources) {
    for (const pattern of pricePatterns) {
      const match = source.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const parsed = extractFirstSEKPrice(stripHtml(removeOldPrices(`${match[1]} kr`)));
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  const prices = extractAllSEKPrices(stripHtml(productArea ?? html)).filter((price) => price > 0 && price < 100000);
  return prices.length > 0 ? prices[0] : null;
}

function extractLikelyProductArea(html: string): string | null {
  const selectors = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+class=["'][^"']*(?:product-detail|product-details|product-info|product-page|productView|product-single)[^"']*["'][^>]*>([\s\S]{0,15000})<\/div>/i,
    /<section[^>]+class=["'][^"']*(?:product-detail|product|product-info)[^"']*["'][^>]*>([\s\S]{0,15000})<\/section>/i,
    /<h1\b[^>]*>[\s\S]*?<\/h1>([\s\S]{0,8000})/i
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
