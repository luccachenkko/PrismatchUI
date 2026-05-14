const supportedScraperDomains = new Set([
  "bygghemma.se",
  "hemmabutiken.se",
  "hemmy.se",
  "cdon.se",
  "themobilestore.se",
  "conrad.se",
  "kulinagroup.se",
  "matlagning.com",
  "vitvarudelen.se",
  "fortaltsbutiken.se",
  "skrotahusvagn.com",
  "campingspecialisten.se"
]);

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
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return supportedScraperDomains.has(normalized);
}
