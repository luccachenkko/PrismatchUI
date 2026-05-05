import type { LinkInput, ScrapedPriceResult } from "../types.js";
import { scrapeCdon } from "./cdon.js";
import { scrapeHemmabutiken } from "./hemmabutiken.js";
import { domainFromUrl } from "./shared.js";
import { scrapeTheMobileStore } from "./themobilestore.js";

type Scraper = (url: string) => Promise<number>;

type ScraperEntry = {
  name: string;
  scrape: Scraper;
};

const SCRAPERS: Array<{ match: string; entry: ScraperEntry }> = [
  { match: "hemmabutiken.se", entry: { name: "Hemmabutiken", scrape: scrapeHemmabutiken } },
  { match: "cdon.se", entry: { name: "CDON", scrape: scrapeCdon } },
  { match: "themobilestore.se", entry: { name: "TheMobileStore", scrape: scrapeTheMobileStore } }
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

    const price = await scraper.entry.scrape(link.url);

    return {
      sku: link.sku,
      url: link.url,
      competitor: scraper.entry.name,
      price,
      status: "success",
      fetchedAt
    };
  } catch (error) {
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

function findScraper(domain: string): { match: string; entry: ScraperEntry } | null {
  return SCRAPERS.find((item) => domain === item.match || domain.endsWith(`.${item.match}`)) ?? null;
}

function safeDomain(url: string): string {
  try {
    return domainFromUrl(url);
  } catch {
    return "ogiltig-url";
  }
}
