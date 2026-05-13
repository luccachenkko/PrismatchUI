import { findScraper, scrapePriceForLink } from "../src/scrapers/index.js";
import { domainFromUrl } from "../src/scrapers/shared.js";

type ReportLine = {
  label: string;
  value: string;
};

const url = process.argv[2]?.trim();

if (!url) {
  printReport([
    { label: "Status", value: "INVALID_URL" },
    { label: "Error", value: "Missing URL argument. Usage: npm run scraper:test -- \"https://example.com/product\"" }
  ]);
  process.exitCode = 1;
} else {
  await run(url);
}

async function run(inputUrl: string): Promise<void> {
  const parsed = parseHttpUrl(inputUrl);

  if (!parsed.ok) {
    printReport([
      { label: "URL", value: inputUrl },
      { label: "Status", value: "INVALID_URL" },
      { label: "Error", value: parsed.error }
    ]);
    process.exitCode = 1;
    return;
  }

  const domain = domainFromUrl(inputUrl);
  const scraper = findScraper(domain);

  if (!scraper) {
    printReport([
      { label: "URL", value: inputUrl },
      { label: "Domain", value: domain },
      { label: "Scraper", value: "SCRAPER_MISSING" },
      { label: "Status", value: "SCRAPER_MISSING" },
      { label: "Error", value: `No scraper registered for domain: ${domain}` }
    ]);
    process.exitCode = 2;
    return;
  }

  const result = await scrapePriceForLink({
    sku: "SCRAPER_TEST",
    url: inputUrl,
    aktiv: true
  });

  const report: ReportLine[] = [
    { label: "URL", value: inputUrl },
    { label: "Domain", value: domain },
    { label: "Scraper", value: `${scraper.entry.name} (${scraper.match})` },
    { label: "Status", value: result.status === "success" ? "PRICE_FOUND" : "SCRAPER_FAILED" }
  ];

  if (result.price !== null) {
    report.push({ label: "Price", value: String(result.price) });
    report.push({ label: "Currency", value: "SEK" });
  }

  if (result.error) {
    report.push({ label: "Error", value: result.error });
  }

  printReport(report);
  process.exitCode = result.status === "success" && result.price !== null ? 0 : 1;
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

function printReport(lines: ReportLine[]): void {
  console.log("SCRAPER_TEST_REPORT");
  for (const line of lines) {
    console.log(`${line.label}: ${line.value}`);
  }
}
