import { AgentApiError, AgentClient } from "./agentClient.js";
import {
  formatLinks,
  formatProduct,
  formatReport,
  formatRules,
  formatRunStarted,
  formatScheduleCreated,
  formatScheduleDeleted,
  formatScheduleDetail,
  formatScheduleList,
  formatScheduleRunResult,
  formatScheduleUpdated,
  formatDate,
  formatMoney
} from "./formatTelegram.js";
import type { CompetitorLink, SchedulePayload, ScheduleScopeType, ScheduleTaskType } from "./telegramTypes.js";
import { createAgentScraperJob, getAgentScraperJob, listAgentScraperJobs } from "../db.js";
import type { AgentScraperJobRow } from "../db.js";
import { findScraper } from "../scrapers/index.js";
import { domainFromUrl } from "../scrapers/shared.js";
import { testScraperUrl } from "../scraperTest.js";
import type { ScraperTestResult } from "../scraperTest.js";

export type CommandContext = {
  chatId: number;
  text: string;
  client: AgentClient;
  dryRun: boolean;
};

const DEFAULT_TIMEZONE = "Europe/Stockholm";

export async function handleTelegramCommand(context: CommandContext): Promise<string> {
  const trimmed = context.text.trim();

  if (!trimmed.startsWith("/")) {
    return handlePlainText(context);
  }

  const { command, args } = parseCommand(trimmed);

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
    case "/testa-lank":
      return testLink(args);
    case "/testa-lankar":
      return testLinks(context.client, args);
    case "/forbered-scraper":
      return prepareScraperJob(context.chatId, args);
    case "/scraper-jobb":
      return scraperJobs(args);
    case "/kor-prismatchning":
      return startPriceRun(context.client, args, context.dryRun);
    case "/senaste-rapport":
      return latestReport(context.client);
    case "/scheman":
      return schedules(context.client);
    case "/schema":
      return scheduleDetail(context.client, args);
    case "/skapa-schema":
    case "/lagg-schema":
      return createSchedule(context.client, args);
    case "/pausa-schema":
      return setScheduleEnabled(context.client, args, false);
    case "/aktivera-schema":
      return setScheduleEnabled(context.client, args, true);
    case "/kor-schema":
    case "/kör-schema":
      return runSchedule(context.client, args);
    case "/ta-bort-schema":
      return deleteSchedule(context.client, args);
    case "/hitta-konkurrenter":
      return "Konkurrentsökning är inte implementerad ännu. Ingen data har sparats.";
    default:
      return `Okänt kommando: ${command}\n\n${helpText()}`;
  }
}

async function handlePlainText(context: CommandContext): Promise<string> {
  const text = context.text.trim();
  const normalized = normalizeText(text);

  if (/^(visa|lista) scheman\b/.test(normalized) || normalized === "scheman") {
    return schedules(context.client);
  }

  const showScheduleMatch = normalized.match(/^(visa )?schema (\d+)$/);
  if (showScheduleMatch) {
    return scheduleDetail(context.client, [showScheduleMatch[2]]);
  }

  const runScheduleMatch = normalized.match(/^(kör|kor) schema (\d+)$/);
  if (runScheduleMatch) {
    return runSchedule(context.client, [runScheduleMatch[2]]);
  }

  const pauseScheduleMatch = normalized.match(/^pausa schema (\d+)$/);
  if (pauseScheduleMatch) {
    return setScheduleEnabled(context.client, [pauseScheduleMatch[1]], false);
  }

  const activateScheduleMatch = normalized.match(/^aktivera schema (\d+)$/);
  if (activateScheduleMatch) {
    return setScheduleEnabled(context.client, [activateScheduleMatch[1]], true);
  }

  const deleteScheduleMatch = normalized.match(/^ta bort schema (\d+)$/);
  if (deleteScheduleMatch) {
    return deleteSchedule(context.client, [deleteScheduleMatch[1]]);
  }

  const testLinkMatch = text.match(/^testa l[äa]nken\s+(https?:\/\/\S+)$/i);
  if (testLinkMatch) {
    return testLink([testLinkMatch[1]]);
  }

  const testLinksMatch = text.match(/^testa l[äa]nkarna p[åa]\s+(.+)$/i);
  if (testLinksMatch) {
    return testLinks(context.client, [testLinksMatch[1].trim()]);
  }

  const prepareScraperMatch = text.match(/^(?:f[öo]rbered scraper f[öo]r|skapa scraper-jobb f[öo]r)\s+(https?:\/\/\S+)$/i);
  if (prepareScraperMatch) {
    return prepareScraperJob(context.chatId, [prepareScraperMatch[1]]);
  }

  if (normalized.includes("schema") || normalized.includes("schemalägg") || normalized.includes("schemalagg")) {
    const words = wordsFromText(text).filter((word) => !["skapa", "schema", "schemalägg", "schemalagg"].includes(word));
    return createSchedule(context.client, words);
  }

  return [
    "Jag kan sätta upp schema, men bara med tydlig schemafras eller slash-kommando ännu.",
    "Exempel:",
    "schemalägg varje dag 06:00",
    "schemalägg varje måndag 06:00",
    "schemalägg var 6:e timme",
    "/skapa-schema dagligen 06:00 ready",
    "/scheman"
  ].join("\n");
}

function parseCommand(text: string): { command: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const rawCommand = parts[0]?.split("@")[0]?.toLowerCase() || "";
  return { command: rawCommand, args: parts.slice(1) };
}

function helpText(): string {
  return [
    "Kommandon",
    "",
    "Grund",
    "/whoami - visa chat id",
    "/help - visa denna hjälp",
    "/status - backendstatus, produkter, lager, senaste körning och schemaantal",
    "",
    "Produkter och länkar",
    "/produkt <SKU> - visa produktinfo",
    "/regler <SKU> - visa prismatchningsregel",
    "/lankar <SKU> - lista konkurrentlänkar",
    "/lagg-lank <SKU> <URL> - lägg till konkurrentlänk",
    "/testa-lank <URL> - testa scraper för en konkurrentlänk",
    "/testa-lankar <SKU> - testa sparade konkurrentlänkar för en produkt",
    "/forbered-scraper <URL> - skapa scraper-jobb och Codex-prompt",
    "/scraper-jobb [id] - lista eller visa scraper-jobb",
    "",
    "Prismatchning och rapporter",
    "/kor-prismatchning alla - skapa ny rapport för befintligt helflöde",
    "/kor-prismatchning <SKU> - inte implementerat ännu",
    "/senaste-rapport - visa senaste rapportsammanfattning",
    "/hitta-konkurrenter <SKU eller EAN> - inte implementerat ännu",
    "",
    "Schemaläggning",
    "/scheman - lista scheman",
    "/schema <id> - visa ett schema",
    "/skapa-schema dagligen <HH:MM> [ready|in_stock|all_active]",
    "/skapa-schema veckovis <måndag-söndag> <HH:MM> [ready|in_stock|all_active]",
    "/skapa-schema varje <N> timmar [ready|in_stock|all_active]",
    "/pausa-schema <id> - pausa schema",
    "/aktivera-schema <id> - aktivera schema",
    "/kor-schema <id> - kör schema nu",
    "/ta-bort-schema <id> - ta bort schema",
    "",
    "Vanlig text",
    "schemalägg varje dag 06:00",
    "schemalägg varje måndag 06:00",
    "schemalägg var 6:e timme",
    "visa scheman",
    "pausa schema 3"
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

  try {
    const existingSchedules = await client.schedules();
    const activeCount = existingSchedules.filter((schedule) => schedule.enabled === 1).length;
    lines.push(`Scheman: ${existingSchedules.length} (${activeCount} aktiva)`);
  } catch (error) {
    lines.push(`Scheman: kunde inte hämtas (${errorMessage(error)})`);
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

async function testLink(args: string[]): Promise<string> {
  const url = requireArg(args, "Använd: /testa-lank <URL>");
  return formatScraperTestResult(await testScraperUrl(url));
}

async function testLinks(client: AgentClient, args: string[]): Promise<string> {
  const sku = requireArg(args, "Använd: /testa-lankar <SKU>");
  const detail = await findProductOrThrow(client, sku);
  const linksToTest = detail.competitorLinks;

  if (linksToTest.length === 0) {
    return `Scrapertest ${detail.product.sku ?? sku}\nInga konkurrentlänkar finns sparade.`;
  }

  const results: Array<{ link: CompetitorLink; result: ScraperTestResult }> = [];
  for (const link of linksToTest) {
    results.push({ link, result: await testScraperUrl(link.url) });
  }

  const okCount = results.filter((item) => item.result.status === "PRICE_FOUND").length;
  const missingCount = results.filter((item) => item.result.status === "SCRAPER_MISSING").length;
  const failedCount = results.filter((item) => item.result.status === "SCRAPER_FAILED" || item.result.status === "INVALID_URL").length;

  return [
    `Scrapertest ${detail.product.sku ?? sku}`,
    `Länkar testade: ${results.length}`,
    `Fungerar: ${okCount}`,
    `Scraper saknas: ${missingCount}`,
    `Scraper misslyckades: ${failedCount}`,
    "",
    ...results.map((item, index) => formatScraperTestSummary(index + 1, item.link, item.result))
  ].join("\n");
}

function prepareScraperJob(chatId: number, args: string[]): string {
  const url = normalizeUrl(requireArg(args, "Använd: /forbered-scraper <URL>"));
  const domain = domainFromUrl(url);
  const scraper = findScraper(domain);

  if (scraper) {
    return [
      `Scraper finns redan för ${domain}.`,
      `Scraper: ${scraper.entry.name}`,
      `Testa länken med: /testa-lank ${url}`
    ].join("\n");
  }

  const codexPrompt = buildScraperCodexPrompt(url, domain);
  const job = createAgentScraperJob({
    chatId: String(chatId),
    sku: null,
    url,
    domain,
    status: "awaiting_codegen",
    codexPrompt,
    resultSummary: "Scraper saknas. Codex-prompt är skapad men inte körd."
  });

  return [
    `Scraper-jobb skapat: #${job.id}`,
    `Domän: ${job.domain}`,
    `Status: ${formatScraperJobStatus(job.status)}`,
    "Agenten kör inte Codex automatiskt.",
    `Hämta prompten med: /scraper-jobb ${job.id}`
  ].join("\n");
}

function scraperJobs(args: string[]): string {
  const rawId = args[0]?.trim();
  if (rawId) {
    const jobId = requirePositiveId(args, "Använd: /scraper-jobb <id>");
    const job = getAgentScraperJob(jobId);
    if (!job) {
      throw new Error(`Scraper-jobb #${jobId} hittades inte.`);
    }

    return formatScraperJobDetail(job);
  }

  const jobs = listAgentScraperJobs(10);
  if (jobs.length === 0) {
    return "Inga scraper-jobb finns ännu.";
  }

  return [
    "Senaste scraper-jobb",
    ...jobs.map((job) =>
      [
        `#${job.id} ${job.domain}`,
        `Status: ${formatScraperJobStatus(job.status)}`,
        job.sku ? `SKU: ${job.sku}` : null,
        `Skapad: ${formatDate(job.created_at)}`
      ]
        .filter(Boolean)
        .join("\n")
    )
  ].join("\n\n");
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

async function schedules(client: AgentClient): Promise<string> {
  return formatScheduleList(await client.schedules());
}

async function scheduleDetail(client: AgentClient, args: string[]): Promise<string> {
  const scheduleId = requirePositiveId(args, "Använd: /schema <id>");
  const existing = await client.schedule(scheduleId);
  if (!existing) {
    throw new Error(`Schema #${scheduleId} hittades inte.`);
  }

  return formatScheduleDetail(existing);
}

async function createSchedule(client: AgentClient, args: string[]): Promise<string> {
  const payload = parseSchedulePayload(args);
  const schedule = await client.createSchedule(payload);
  return formatScheduleCreated(schedule);
}

async function setScheduleEnabled(client: AgentClient, args: string[], enabled: boolean): Promise<string> {
  const scheduleId = requirePositiveId(args, enabled ? "Använd: /aktivera-schema <id>" : "Använd: /pausa-schema <id>");
  const existing = await client.schedule(scheduleId);
  if (!existing) {
    throw new Error(`Schema #${scheduleId} hittades inte.`);
  }

  const schedule = await client.updateSchedule(scheduleId, { enabled });
  return formatScheduleUpdated(schedule, enabled ? "Aktiverat" : "Pausat");
}

async function runSchedule(client: AgentClient, args: string[]): Promise<string> {
  const scheduleId = requirePositiveId(args, "Använd: /kor-schema <id>");
  return formatScheduleRunResult(await client.runScheduleNow(scheduleId));
}

async function deleteSchedule(client: AgentClient, args: string[]): Promise<string> {
  const scheduleId = requirePositiveId(args, "Använd: /ta-bort-schema <id>");
  const existing = await client.schedule(scheduleId);
  if (!existing) {
    throw new Error(`Schema #${scheduleId} hittades inte.`);
  }

  await client.deleteSchedule(scheduleId);
  return formatScheduleDeleted(scheduleId);
}

function formatScraperTestResult(result: ScraperTestResult): string {
  return [
    "Scrapertest",
    result.domain ? `Domän: ${result.domain}` : null,
    `Status: ${formatScraperTestStatus(result)}`,
    result.scraperName ? `Scraper: ${result.scraperName}` : null,
    result.price !== null ? `Pris: ${formatMoney(result.price)}` : null,
    result.currency ? `Valuta: ${result.currency}` : null,
    result.error ? `Felorsak: ${result.error}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function formatScraperTestSummary(index: number, link: CompetitorLink, result: ScraperTestResult): string {
  const details =
    result.status === "PRICE_FOUND" && result.price !== null
      ? `Pris: ${formatMoney(result.price)}`
      : result.error
        ? `Fel: ${result.error}`
        : null;

  return [
    `${index}. ${result.domain ?? link.domain}`,
    `Status: ${formatScraperTestStatus(result)}`,
    `URL: ${link.url}`,
    link.enabled !== 1 ? "Aktiv: nej" : null,
    details
  ]
    .filter(Boolean)
    .join("\n");
}

function formatScraperTestStatus(result: ScraperTestResult): string {
  if (result.status === "PRICE_FOUND") return "OK";
  if (result.status === "SCRAPER_MISSING") return "scraper saknas";
  if (result.status === "INVALID_URL") return "ogiltig URL";
  return "scraper misslyckades";
}

function formatScraperJobDetail(job: AgentScraperJobRow): string {
  const prompt = job.codex_prompt ?? "Prompt saknas.";

  return [
    `Scraper-jobb #${job.id}`,
    `Status: ${formatScraperJobStatus(job.status)}`,
    `Domän: ${job.domain}`,
    `URL: ${job.url}`,
    job.sku ? `SKU: ${job.sku}` : "SKU: -",
    `Skapad: ${formatDate(job.created_at)}`,
    `Uppdaterad: ${formatDate(job.updated_at)}`,
    "",
    `Prompt-preview: ${previewText(prompt, 280)}`,
    "",
    `Nästa steg: ${nextScraperJobStep(job)}`,
    "",
    "Codex-prompt:",
    prompt
  ].join("\n");
}

function formatScraperJobStatus(status: string): string {
  const labels: Record<string, string> = {
    created: "skapad",
    awaiting_codegen: "väntar på manuell Codex-körning",
    generating: "genererar",
    testing: "testar",
    awaiting_user_approval: "väntar på godkännande",
    approved: "godkänd",
    rejected: "avvisad",
    failed: "misslyckad"
  };

  return labels[status] ?? status;
}

function nextScraperJobStep(job: AgentScraperJobRow): string {
  if (job.status === "awaiting_codegen" || job.status === "created") {
    return "Kopiera Codex-prompten och kör den manuellt. Agenten kör inte Codex automatiskt.";
  }

  if (job.status === "failed") {
    return "Läs felorsaken och skapa ett nytt jobb om URL eller domän fortfarande behöver scraper.";
  }

  if (job.status === "approved") {
    return "Ingen åtgärd krävs.";
  }

  return "Granska jobbstatus innan nästa manuella steg.";
}

function buildScraperCodexPrompt(url: string, domain: string): string {
  const fileName = `${safeDomainFileName(domain)}.ts`;
  const commandUrl = url.replace(/"/g, '\\"');

  return [
    "Du arbetar i mitt befintliga Shopify-prismatchningsprojekt i C:\\Dev\\PrismatchUI.",
    "",
    "Mål:",
    `Skapa en riktig scraper för domänen ${domain} och testa den mot denna verkliga URL:`,
    url,
    "",
    "Krav:",
    `- Skapa src/scrapers/${fileName}.`,
    "- Återanvänd helpers från src/scrapers/shared.ts.",
    "- Registrera scrapern i src/scrapers/index.ts.",
    "- Lägg domänen i src/scraperSupport.ts om projektet använder den filen.",
    "- Skapa inte mockdata, fake-data eller fallbackdata som låtsas vara riktig.",
    "- Skriv inte över befintliga scrapers.",
    "- Ändra inte Shopify-kod.",
    "- Ändra inte frontend.",
    "- Ändra inte .env.",
    "- Uppdatera inte Shopify.",
    "- Godkänn inga prisändringar.",
    "- Gör minsta stabila implementation.",
    "",
    "Scraperbeteende:",
    "- Hämta endast pris från den riktiga produktsidan.",
    "- Hämta inte och använd inte konkurrentens lagerstatus.",
    "- Returnera ett numeriskt pris i SEK på samma sätt som befintliga scrapers.",
    "- Kasta ett tydligt fel om pris inte hittas.",
    "",
    "Verifiering:",
    `- Kör npm run scraper:test -- \"${commandUrl}\"`,
    "- Kör npm run typecheck",
    "",
    "Rapportera exakt:",
    "- ändrade filer",
    "- testresultat",
    "- eventuell felorsak om scrapern inte kan verifieras"
  ].join("\n");
}

function safeDomainFileName(domain: string): string {
  const normalized = domain
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "scraper";
}

function previewText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3)}...`;
}

function parseSchedulePayload(rawArgs: string[]): SchedulePayload {
  const args = rawArgs.map(normalizeTextToken).filter(Boolean);
  const frequency = parseFrequency(args);
  const scope_type = parseScope(args);
  const task_type = parseTaskType(args);
  const name = buildScheduleName(frequency, task_type);

  return {
    name,
    task_type,
    scope_type,
    frequency_type: frequency.frequency_type,
    time_of_day: frequency.time_of_day,
    interval_hours: frequency.interval_hours,
    weekday: frequency.weekday,
    timezone: DEFAULT_TIMEZONE,
    enabled: true
  };
}

function parseFrequency(args: string[]): Pick<SchedulePayload, "frequency_type" | "time_of_day" | "interval_hours" | "weekday"> {
  const hasWeekly = args.some((arg) => arg === "veckovis" || arg === "vecka" || arg === "weekly") || args.some((arg) => weekdayNumber(arg) !== null);
  const hasHourly = args.some((arg) => ["var", "varje", "timme", "timmar", "hourly"].includes(arg)) && args.some((arg) => integerFromToken(arg) !== null);

  if (hasHourly && args.some((arg) => arg === "timme" || arg === "timmar" || arg === "hourly")) {
    return {
      frequency_type: "hourly",
      time_of_day: null,
      interval_hours: firstInteger(args) ?? 6,
      weekday: null
    };
  }

  if (hasWeekly) {
    const weekday = args.map(weekdayNumber).find((value): value is number => value !== null) ?? 1;
    return {
      frequency_type: "weekly",
      time_of_day: firstTime(args) ?? "06:00",
      interval_hours: null,
      weekday
    };
  }

  if (args.some((arg) => arg === "dagligen" || arg === "dag" || arg === "daily") || firstTime(args)) {
    return {
      frequency_type: "daily",
      time_of_day: firstTime(args) ?? "06:00",
      interval_hours: null,
      weekday: null
    };
  }

  throw new Error(
    [
      "Kunde inte tolka schemat.",
      "Exempel:",
      "/skapa-schema dagligen 06:00 ready",
      "/skapa-schema veckovis måndag 06:00 ready",
      "/skapa-schema varje 6 timmar ready"
    ].join("\n")
  );
}

function parseScope(args: string[]): ScheduleScopeType {
  if (args.some((arg) => ["all_active", "alla", "alla-aktiva", "aktiv", "aktiva"].includes(arg))) {
    return "all_active";
  }

  if (args.some((arg) => ["in_stock", "lager", "i-lager", "instock", "stock"].includes(arg))) {
    return "in_stock";
  }

  return "ready";
}

function parseTaskType(args: string[]): ScheduleTaskType {
  if (args.some((arg) => ["shopify", "synk", "sync"].includes(arg)) && args.every((arg) => !["prismatchning", "prismatch", "pris"].includes(arg))) {
    return "shopify_sync_only";
  }

  if (args.some((arg) => ["utan-synk", "utan_sync", "bara-prismatchning", "price_match_only"].includes(arg))) {
    return "price_match_only";
  }

  return "sync_and_price_match";
}

function buildScheduleName(
  frequency: Pick<SchedulePayload, "frequency_type" | "time_of_day" | "interval_hours" | "weekday">,
  taskType: ScheduleTaskType
): string {
  const prefix = taskType === "price_match_only" ? "Telegram: prismatchning" : taskType === "shopify_sync_only" ? "Telegram: Shopify-synk" : "Telegram: synk + prismatchning";

  if (frequency.frequency_type === "hourly") {
    return `${prefix} var ${frequency.interval_hours ?? 6}:e timme`;
  }

  if (frequency.frequency_type === "weekly") {
    return `${prefix} ${weekdayName(frequency.weekday ?? 1)} ${frequency.time_of_day ?? "06:00"}`;
  }

  return `${prefix} dagligen ${frequency.time_of_day ?? "06:00"}`;
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

function requirePositiveId(args: string[], usage: string): number {
  const rawValue = requireArg(args, usage);
  const id = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(usage);
  }

  return id;
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

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function wordsFromText(value: string): string[] {
  return value
    .replace(/[,.;!?()\[\]]/g, " ")
    .split(/\s+/)
    .map(normalizeTextToken)
    .filter(Boolean);
}

function normalizeTextToken(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function firstTime(args: string[]): string | null {
  return args.find((arg) => /^\d{1,2}:\d{2}$/.test(arg))?.replace(/^(\d):/, "0$1:") ?? null;
}

function firstInteger(args: string[]): number | null {
  return args.map(integerFromToken).find((value): value is number => value !== null) ?? null;
}

function integerFromToken(value: string): number | null {
  const match = value.match(/^(\d+)(?::?e)?$/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function weekdayNumber(value: string): number | null {
  const normalized = normalizeTextToken(value);
  const map: Record<string, number> = {
    "1": 1,
    måndag: 1,
    mandag: 1,
    mån: 1,
    man: 1,
    monday: 1,
    "2": 2,
    tisdag: 2,
    tis: 2,
    tuesday: 2,
    "3": 3,
    onsdag: 3,
    ons: 3,
    wednesday: 3,
    "4": 4,
    torsdag: 4,
    tor: 4,
    thursday: 4,
    "5": 5,
    fredag: 5,
    fre: 5,
    friday: 5,
    "6": 6,
    lördag: 6,
    lordag: 6,
    lör: 6,
    lor: 6,
    saturday: 6,
    "7": 7,
    söndag: 7,
    sondag: 7,
    sön: 7,
    son: 7,
    sunday: 7
  };

  return map[normalized] ?? null;
}

function weekdayName(value: number): string {
  const map: Record<number, string> = {
    1: "måndag",
    2: "tisdag",
    3: "onsdag",
    4: "torsdag",
    5: "fredag",
    6: "lördag",
    7: "söndag"
  };

  return map[value] ?? String(value);
}

export function isWhoamiCommand(text: string): boolean {
  return parseCommand(text).command === "/whoami";
}
