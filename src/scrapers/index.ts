import type { LinkInput, ScrapedPriceResult } from "../types.js";
import { scrapeBygghemma } from "./bygghemma-se.js";
import { scrapeCdon } from "./cdon.js";
import { scrapeCampingspecialisten } from "./campingspecialisten.js";
import { scrapeConrad } from "./conrad.js";
import { scrapeFortaltsbutiken } from "./fortaltsbutiken.js";
import { scrapeHemmabutiken } from "./hemmabutiken.js";
import { scrapeHemmy } from "./hemmy.js";
import { scrapeKokochmer } from "./kokochmer-se.js";
import { scrapeKulina } from "./kulina.js";
import { scrapeMatlagning } from "./matlagning.js";
import { domainFromUrl, isScraperDebugEnabled } from "./shared.js";
import { scrapeSkrotahusvagn } from "./skrotahusvagn.js";
import { scrapeTheMobileStore } from "./themobilestore.js";
import { scrapeVitvarudelen } from "./vitvarudelen.js";

type Scraper = (url: string) => Promise<number>;

export type ScraperEntry = {
  name: string;
  scrape: Scraper;
};

export type ScraperMatch = {
  match: string;
  entry: ScraperEntry;
};

const SCRAPERS: ScraperMatch[] = [
  { match: "bygghemma.se", entry: { name: "Bygghemma", scrape: scrapeBygghemma } },
  { match: "hemmabutiken.se", entry: { name: "Hemmabutiken", scrape: scrapeHemmabutiken } },
  { match: "hemmy.se", entry: { name: "Hemmy", scrape: scrapeHemmy } },
  { match: "kokochmer.se", entry: { name: "Kok & Mer", scrape: scrapeKokochmer } },
  { match: "cdon.se", entry: { name: "CDON", scrape: scrapeCdon } },
  { match: "themobilestore.se", entry: { name: "TheMobileStore", scrape: scrapeTheMobileStore } },
  { match: "conrad.se", entry: { name: "Conrad", scrape: scrapeConrad } },
  { match: "kulinagroup.se", entry: { name: "Kulina", scrape: scrapeKulina } },
  { match: "matlagning.com", entry: { name: "Matlagning", scrape: scrapeMatlagning } },
  { match: "vitvarudelen.se", entry: { name: "Vitvarudelen", scrape: scrapeVitvarudelen } },
  { match: "fortaltsbutiken.se", entry: { name: "Fortaltsbutiken", scrape: scrapeFortaltsbutiken } },
  { match: "skrotahusvagn.com", entry: { name: "SkrotaHusvagn", scrape: scrapeSkrotahusvagn } },
  { match: "campingspecialisten.se", entry: { name: "Campingspecialisten", scrape: scrapeCampingspecialisten } }
];

export async function scrapePriceForLink(link: LinkInput): Promise<ScrapedPriceResult> {
  const fetchedAt = new Date().toISOString();

  try {
    const domain = domainFromUrl(link.url);
    const scraper = findScraper(domain);

    if (!scraper) {
      return {
        sku: link.sku,
        url: link.url,
        competitor: domain,
        price: null,
        status: "failed",
        error: `Ingen scraper finns for domanen: ${domain}`,
        fetchedAt
      };
    }

    if (isScraperDebugEnabled()) {
      console.log(`[scraper-debug] ${link.sku} ${domain}: startar`);
    }

    const price = await scraper.entry.scrape(link.url);

    if (!Number.isFinite(price) || price <= 0) {
      return {
        sku: link.sku,
        url: link.url,
        competitor: scraper.entry.name,
        price: null,
        status: "failed",
        error: `Ogiltigt pris hamtades: ${price}`,
        fetchedAt
      };
    }

    if (isScraperDebugEnabled()) {
      console.log(`[scraper-debug] ${link.sku} ${domain}: pris ${price}`);
    }

    return {
      sku: link.sku,
      url: link.url,
      competitor: scraper.entry.name,
      price,
      status: "success",
      fetchedAt
    };
  } catch (error) {
    if (isScraperDebugEnabled()) {
      console.log(`[scraper-debug] ${link.sku} ${safeDomain(link.url)}: fel ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      sku: link.sku,
      url: link.url,
      competitor: safeDomain(link.url),
      price: null,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      fetchedAt
    };
  }
}

export function findScraper(domain: string): ScraperMatch | null {
  return SCRAPERS.find((item) => domain === item.match || domain.endsWith(`.${item.match}`)) ?? null;
}

function safeDomain(url: string): string {
  try {
    return domainFromUrl(url);
  } catch {
    return "ogiltig-url";
  }
}
