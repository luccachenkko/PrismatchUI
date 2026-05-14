import { testScraperUrl } from "../src/scraperTest.js";
import type { ScraperTestResult } from "../src/scraperTest.js";

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
  const result = await testScraperUrl(url);
  printScraperTestReport(result);
  process.exitCode = exitCodeForResult(result);
}

function printReport(lines: ReportLine[]): void {
  console.log("SCRAPER_TEST_REPORT");
  for (const line of lines) {
    console.log(`${line.label}: ${line.value}`);
  }
}

function printScraperTestReport(result: ScraperTestResult): void {
  const report: ReportLine[] = [
    { label: "URL", value: result.url },
    result.domain ? { label: "Domain", value: result.domain } : null,
    { label: "Scraper", value: scraperLabel(result) },
    { label: "Status", value: result.status },
    result.price !== null ? { label: "Price", value: String(result.price) } : null,
    result.currency ? { label: "Currency", value: result.currency } : null,
    result.error ? { label: "Error", value: result.error } : null
  ].filter((line): line is ReportLine => line !== null);

  printReport(report);
}

function scraperLabel(result: ScraperTestResult): string {
  if (result.scraperName) {
    return `${result.scraperName} (${result.scraperMatch})`;
  }

  return result.status === "SCRAPER_MISSING" ? "SCRAPER_MISSING" : "-";
}

function exitCodeForResult(result: ScraperTestResult): number {
  if (result.status === "PRICE_FOUND") {
    return 0;
  }

  if (result.status === "SCRAPER_MISSING") {
    return 2;
  }

  return 1;
}
