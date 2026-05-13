import { AgentApiError, AgentClient } from "./agentClient.js";
import {
  formatLinks,
  formatProduct,
  formatReport,
  formatRules,
  formatRunStarted,
  formatStatusLabel,
  formatDate
} from "./formatTelegram.js";

export type CommandContext = {
  chatId: number;
  text: string;
  client: AgentClient;
  dryRun: boolean;
};

export async function handleTelegramCommand(context: CommandContext): Promise<string> {
  const { command, args } = parseCommand(context.text);

  switch (command) {
    case "/whoami":
      return `Chat id: ${context.chatId}`;
    case "/help":
      return helpText();
    case "/status":
      return status(context.client);
    case "/produkt":
      return product(context.client, args);
    case "/regler":
      return rules(context.client, args);
    case "/lankar":
      return links(context.client, args);
    case "/lagg-lank":
      return addLink(context.client, args);
    case "/kor-prismatchning":
      return startPriceRun(context.client, args, context.dryRun);
    case "/senaste-rapport":
      return latestReport(context.client);
    case "/hitta-konkurrenter":
      return "Konkurrentsökning är inte implementerad ännu. Ingen data har sparats.";
    default:
      return `Okänt kommando: ${command}\n\n${helpText()}`;
  }
}

function parseCommand(text: string): { command: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const rawCommand = parts[0]?.split("@")[0]?.toLowerCase() || "";
  return { command: rawCommand, args: parts.slice(1) };
}

function helpText(): string {
  return [
    "Kommandon:",
    "/whoami - visa chat id",
    "/status - backendstatus och senaste körning",
    "/produkt <SKU> - visa produktinfo",
    "/regler <SKU> - visa prismatchningsregel",
    "/lankar <SKU> - lista konkurrentlänkar",
    "/lagg-lank <SKU> <URL> - lägg till konkurrentlänk",
    "/kor-prismatchning <alla> - skapa ny rapport",
    "/kor-prismatchning <SKU> - inte implementerat ännu",
    "/senaste-rapport - visa senaste rapportsammanfattning",
    "/hitta-konkurrenter <SKU eller EAN> - inte implementerat ännu"
  ].join("\n");
}

async function status(client: AgentClient): Promise<string> {
  try {
    await client.health();
  } catch (error) {
    return `Backend: offline\nFel: ${errorMessage(error)}`;
  }

  const lines = ["Backend: online"];

  try {
    const { stats } = await client.products();
    lines.push(`Produkter: ${stats.productCount}`);
    lines.push(`I lager: ${stats.inStockCount}`);
  } catch (error) {
    lines.push(`Produkter: kunde inte hämtas (${errorMessage(error)})`);
  }

  try {
    const runs = await client.priceRuns();
    const latest = runs[0];
    lines.push(
      latest
        ? `Senaste körning: run ${latest.id}, ${latest.status}, ${formatDate(latest.started_at)}`
        : "Senaste körning: ingen rapport finns"
    );
  } catch (error) {
    lines.push(`Senaste körning: kunde inte hämtas (${errorMessage(error)})`);
  }

  return lines.join("\n");
}

async function product(client: AgentClient, args: string[]): Promise<string> {
  const sku = requireArg(args, "Använd: /produkt <SKU>");
  const detail = await findProductOrThrow(client, sku);
  return formatProduct(detail);
}

async function rules(client: AgentClient, args: string[]): Promise<string> {
  const sku = requireArg(args, "Använd: /regler <SKU>");
  const detail = await findProductOrThrow(client, sku);
  return formatRules(detail);
}

async function links(client: AgentClient, args: string[]): Promise<string> {
  const sku = requireArg(args, "Använd: /lankar <SKU>");
  const detail = await findProductOrThrow(client, sku);
  return formatLinks(detail);
}

async function addLink(client: AgentClient, args: string[]): Promise<string> {
  if (args.length < 2) {
    return "Använd: /lagg-lank <SKU> <URL>";
  }

  const [sku, rawUrl] = args;
  const url = normalizeUrl(rawUrl);
  const detail = await findProductOrThrow(client, sku);
  const duplicate = detail.competitorLinks.some((link) => normalizeUrl(link.url) === url);

  if (duplicate) {
    return `Länken finns redan på SKU ${detail.product.sku ?? sku}. Ingen data sparades.`;
  }

  const link = await client.createCompetitorLink(detail.product.id, url);
  return [
    `Konkurrentlänk sparad för ${detail.product.sku ?? sku}.`,
    `Domän: ${link.domain}`,
    `URL: ${link.url}`,
    typeof link.scraper_supported === "boolean" ? `Scraper: ${link.scraper_supported ? "stöds" : "saknas"}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

async function startPriceRun(client: AgentClient, args: string[], dryRun: boolean): Promise<string> {
  const scope = args[0]?.trim();
  if (!scope) {
    return "Använd: /kor-prismatchning <alla>\nSKU-körning finns inte i backend ännu.";
  }

  if (scope.toLowerCase() !== "alla") {
    return [
      "SKU-körning är inte implementerad i befintlig backend ännu.",
      "Ingen prismatchningskörning startades och ingen data har sparats.",
      "Använd /kor-prismatchning alla för befintligt helflöde."
    ].join("\n");
  }

  const run = await client.startPriceRun();
  return formatRunStarted(run, dryRun);
}

async function latestReport(client: AgentClient): Promise<string> {
  const runs = await client.priceRuns();
  const latest = runs[0];
  if (!latest) {
    return "Ingen rapport finns ännu.";
  }

  const report = await client.priceRunReport(latest.id);
  return formatReport(report);
}

async function findProductOrThrow(client: AgentClient, sku: string) {
  const detail = await client.findProductBySku(sku);
  if (!detail) {
    throw new Error(`Produkten hittades inte för SKU ${sku}.`);
  }

  return detail;
}

function requireArg(args: string[], usage: string): string {
  const value = args[0]?.trim();
  if (!value) {
    throw new Error(usage);
  }

  return value;
}

function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("URL är ogiltig.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL måste börja med http:// eller https://.");
  }

  return parsed.href;
}

function errorMessage(error: unknown): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

export function isWhoamiCommand(text: string): boolean {
  return parseCommand(text).command === "/whoami";
}
