import { findScraper, scrapePriceForLink } from "./scrapers/index.js";
import { domainFromUrl } from "./scrapers/shared.js";

export type ScraperTestStatus = "PRICE_FOUND" | "SCRAPER_FAILED" | "SCRAPER_MISSING" | "INVALID_URL";

export type ScraperTestResult = {
  url: string;
  domain: string | null;
  scraperName: string | null;
  scraperMatch: string | null;
  status: ScraperTestStatus;
  price: number | null;
  currency: "SEK" | null;
  error: string | null;
};

export async function testScraperUrl(inputUrl: string): Promise<ScraperTestResult> {
  const normalizedUrl = inputUrl.trim();
  const parsed = parseHttpUrl(normalizedUrl);

  if (!parsed.ok) {
    return {
      url: normalizedUrl,
      domain: null,
      scraperName: null,
      scraperMatch: null,
      status: "INVALID_URL",
      price: null,
      currency: null,
      error: parsed.error
    };
  }

  const domain = domainFromUrl(normalizedUrl);
  const scraper = findScraper(domain);

  if (!scraper) {
    return {
      url: normalizedUrl,
      domain,
      scraperName: null,
      scraperMatch: null,
      status: "SCRAPER_MISSING",
      price: null,
      currency: null,
      error: `No scraper registered for domain: ${domain}`
    };
  }

  const result = await scrapePriceForLink({
    sku: "SCRAPER_TEST",
    url: normalizedUrl,
    aktiv: true
  });

  if (result.status === "success" && result.price !== null) {
    return {
      url: normalizedUrl,
      domain,
      scraperName: scraper.entry.name,
      scraperMatch: scraper.match,
      status: "PRICE_FOUND",
      price: result.price,
      currency: "SEK",
      error: null
    };
  }

  return {
    url: normalizedUrl,
    domain,
    scraperName: scraper.entry.name,
    scraperMatch: scraper.match,
    status: "SCRAPER_FAILED",
    price: null,
    currency: null,
    error: result.error ?? "Scraper failed without an error message."
  };
}

function parseHttpUrl(inputUrl: string): { ok: true } | { ok: false; error: string } {
  let parsed: URL;

  try {
    parsed = new URL(inputUrl);
  } catch {
    return { ok: false, error: "URL is not valid." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must start with http:// or https://." };
  }

  if (!parsed.hostname) {
    return { ok: false, error: "URL is missing a domain." };
  }

  return { ok: true };
}
