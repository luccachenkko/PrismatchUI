const supportedScraperDomains = new Set(["hemmabutiken.se", "cdon.se", "themobilestore.se"]);

export function extractDomainFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Ogiltig URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL måste börja med http:// eller https://.");
  }

  const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!domain) {
    throw new Error("URL saknar domän.");
  }

  return domain;
}

export function hasSupportedScraper(domain: string): boolean {
  return supportedScraperDomains.has(domain.toLowerCase().replace(/^www\./, ""));
}
