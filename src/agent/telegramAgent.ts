import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentClient } from "./agentClient.js";
import { formatReport } from "./formatTelegram.js";
import { handleTelegramCommand, isWhoamiCommand } from "./telegramCommands.js";
import type { Schedule, TelegramApiResponse, TelegramUpdate } from "./telegramTypes.js";
import { loadDotEnv } from "../env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

loadDotEnv(path.join(projectRoot, ".env"));

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
const apiBaseUrl = process.env.AGENT_API_BASE_URL?.trim() || "http://localhost:3000";
const dryRun = parseBoolean(process.env.AGENT_DRY_RUN, true);
const telegramDebug = parseBoolean(process.env.AGENT_TELEGRAM_DEBUG ?? process.env.AGENT_DEBUG, false);
const scheduleNotificationsEnabled = parseBoolean(process.env.AGENT_SCHEDULE_NOTIFY, true);
const scheduleNotificationIntervalMs = parsePositiveInteger(process.env.AGENT_SCHEDULE_NOTIFY_INTERVAL_MS, 60_000);

class RunNotificationTracker {
  private readonly seenRunIds = new Set<number>();

  markExistingSchedulesSeen(schedules: Schedule[]): void {
    for (const schedule of schedules) {
      if (schedule.last_run_id) {
        this.seenRunIds.add(schedule.last_run_id);
      }
    }
  }

  hasSeen(runId: number): boolean {
    return this.seenRunIds.has(runId);
  }

  markSeen(runId: number): void {
    this.seenRunIds.add(runId);
  }

  markRunIdsSeenFromText(text: string): void {
    const matches = text.matchAll(/\brun\s+#?(\d+)\b/gi);
    for (const match of matches) {
      const runId = Number.parseInt(match[1] ?? "", 10);
      if (Number.isInteger(runId)) {
        this.markSeen(runId);
      }
    }
  }
}

if (!botToken) {
  console.error("TELEGRAM_BOT_TOKEN saknas i .env");
  process.exitCode = 1;
} else {
  const client = new AgentClient(apiBaseUrl);
  const runTracker = new RunNotificationTracker();
  void startPolling({ botToken, allowedChatIds, client, dryRun, telegramDebug, runTracker });

  if (scheduleNotificationsEnabled) {
    void startScheduleNotificationLoop({
      botToken,
      allowedChatIds,
      client,
      intervalMs: scheduleNotificationIntervalMs,
      runTracker,
      telegramDebug
    });
  } else {
    console.log("Telegram schema-notiser är avstängda via AGENT_SCHEDULE_NOTIFY=false.");
  }
}

async function startPolling(options: {
  botToken: string;
  allowedChatIds: Set<string>;
  client: AgentClient;
  dryRun: boolean;
  telegramDebug: boolean;
  runTracker: RunNotificationTracker;
}): Promise<void> {
  let offset = 0;
  console.log("Telegram-agent startad med long polling.");
  console.log(`Telegram API: https://api.telegram.org/bot<hidden> | debug=${options.telegramDebug ? "on" : "off"}`);

  while (true) {
    try {
      const updates = await telegramRequest<TelegramUpdate[]>(options.botToken, "getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"]
      });

      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        await handleUpdate(update, options);
      }
    } catch (error) {
      console.error(formatTelegramPollingError(error, options.telegramDebug));
      await sleep(3000);
    }
  }
}

async function startScheduleNotificationLoop(options: {
  botToken: string;
  allowedChatIds: Set<string>;
  client: AgentClient;
  intervalMs: number;
  runTracker: RunNotificationTracker;
  telegramDebug: boolean;
}): Promise<void> {
  if (options.allowedChatIds.size === 0) {
    console.log("Telegram schema-notiser väntar: TELEGRAM_ALLOWED_CHAT_IDS saknas.");
    return;
  }

  let baselineReady = false;
  console.log(`Telegram schema-notiser aktiva. Intervall: ${options.intervalMs} ms.`);

  while (true) {
    try {
      const schedules = await options.client.schedules();

      if (!baselineReady) {
        options.runTracker.markExistingSchedulesSeen(schedules);
        baselineReady = true;
        await sleep(options.intervalMs);
        continue;
      }

      for (const schedule of schedules) {
        const runId = schedule.last_run_id;
        if (!runId || options.runTracker.hasSeen(runId)) {
          continue;
        }

        options.runTracker.markSeen(runId);
        await notifyScheduleRun(options, schedule, runId);
      }
    } catch (error) {
      console.error(`[agent] Schema-notiser kunde inte kontrolleras: ${describeError(error, { includeStack: options.telegramDebug })}`);
    }

    await sleep(options.intervalMs);
  }
}

async function notifyScheduleRun(
  options: {
    botToken: string;
    allowedChatIds: Set<string>;
    client: AgentClient;
    runTracker: RunNotificationTracker;
  },
  schedule: Schedule,
  runId: number
): Promise<void> {
  let message: string;

  if (schedule.last_error) {
    message = [
      `Schema #${schedule.id} har kört men fick fel.`,
      `Namn: ${schedule.name}`,
      `Fel: ${schedule.last_error}`,
      runId ? `Senaste run: ${runId}` : null
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    try {
      const report = await options.client.priceRunReport(runId);
      message = [`Schema #${schedule.id} har kört.`, `Namn: ${schedule.name}`, "", "/senaste-rapport", "", formatReport(report)].join(
        "\n"
      );
    } catch (error) {
      message = [
        `Schema #${schedule.id} har kört.`,
        `Namn: ${schedule.name}`,
        `Rapport: run ${runId}`,
        `Kunde inte hämta rapportsammanfattning: ${safeErrorMessage(error)}`
      ].join("\n");
    }
  }

  await notifyAllowedChats(options.botToken, options.allowedChatIds, message);
}

async function notifyAllowedChats(botToken: string, allowedChatIds: Set<string>, text: string): Promise<void> {
  for (const rawChatId of allowedChatIds) {
    const chatId = Number.parseInt(rawChatId, 10);
    if (!Number.isInteger(chatId)) {
      console.warn(`[agent] Ogiltigt chat id i TELEGRAM_ALLOWED_CHAT_IDS: ${rawChatId}`);
      continue;
    }

    try {
      await sendMessage(botToken, chatId, text);
    } catch (error) {
      console.error(`[agent] Kunde inte skicka schema-notis till ${chatId}: ${safeErrorMessage(error)}`);
    }
  }
}

async function handleUpdate(
  update: TelegramUpdate,
  options: {
    botToken: string;
    allowedChatIds: Set<string>;
    client: AgentClient;
    dryRun: boolean;
    runTracker: RunNotificationTracker;
  }
): Promise<void> {
  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text) {
    return;
  }

  const chatId = message.chat.id;
  const isAllowed = options.allowedChatIds.has(String(chatId));
  const onlyWhoamiAllowed = options.allowedChatIds.size === 0;

  if ((onlyWhoamiAllowed || !isAllowed) && !isWhoamiCommand(text)) {
    await sendMessage(
      options.botToken,
      chatId,
      "Chat id är inte tillåtet ännu. Kör /whoami och lägg sedan in id:t i TELEGRAM_ALLOWED_CHAT_IDS."
    );
    return;
  }

  try {
    const response = await handleTelegramCommand({
      chatId,
      text,
      client: options.client,
      dryRun: options.dryRun
    });
    options.runTracker.markRunIdsSeenFromText(response);
    await sendMessage(options.botToken, chatId, response);
  } catch (error) {
    await sendMessage(options.botToken, chatId, `Fel: ${safeErrorMessage(error)}`);
  }
}

async function sendMessage(botToken: string, chatId: number, text: string): Promise<void> {
  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: limitTelegramMessage(text)
  });
}

async function telegramRequest<T>(botToken: string, method: string, body: Record<string, unknown>): Promise<T> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw wrapTelegramFetchError(method, error);
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (error) {
    throw new Error(`Telegram API ${method}: kunde inte läsa svarstext. ${safeErrorMessage(error)}`);
  }

  let payload: TelegramApiResponse<T>;
  try {
    payload = JSON.parse(rawText) as TelegramApiResponse<T>;
  } catch {
    const preview = rawText.trim().slice(0, 300) || "tomt svar";
    throw new Error(`Telegram API ${method}: svaret var inte giltig JSON. HTTP ${response.status}. Svar: ${preview}`);
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram API ${method}: HTTP ${response.status}.`);
  }

  return payload.result as T;
}

function parseAllowedChatIds(rawValue: string | undefined): Set<string> {
  return new Set(
    (rawValue ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (!rawValue) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "ja"].includes(normalized)) return true;
  if (["0", "false", "no", "nej"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function limitTelegramMessage(text: string): string {
  if (text.length <= 3900) {
    return text;
  }

  return `${text.slice(0, 3890)}\n...`;
}

function wrapTelegramFetchError(method: string, error: unknown): Error {
  const details = describeError(error, { includeStack: false });
  return new Error(`Telegram API ${method}: fetch misslyckades. ${details}`);
}

function formatTelegramPollingError(error: unknown, debug: boolean): string {
  const details = describeError(error, { includeStack: debug });
  return [
    `[agent] Telegram-agentfel: ${details}`,
    "[agent] Kontrollera: internetanslutning, VPN/brandvägg/proxy, TELEGRAM_BOT_TOKEN och att Telegram inte blockeras i nätverket.",
    debug ? "[agent] Debug är på via AGENT_TELEGRAM_DEBUG=true." : "[agent] Sätt AGENT_TELEGRAM_DEBUG=true i .env för stack trace."
  ].join("\n");
}

function safeErrorMessage(error: unknown): string {
  return describeError(error, { includeStack: false });
}

function describeError(error: unknown, options: { includeStack: boolean }): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [`${error.name}: ${error.message}`];
  const cause = getErrorCause(error);
  if (cause) {
    parts.push(`cause=${describeCause(cause)}`);
  }

  const code = getErrorCode(error);
  if (code) {
    parts.push(`code=${code}`);
  }

  if (options.includeStack && error.stack) {
    parts.push(`stack=${error.stack}`);
  }

  return parts.join(" | ");
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    const code = getErrorCode(cause);
    const nestedCause = getErrorCause(cause);
    const base = `${cause.name}: ${cause.message}${code ? ` | code=${code}` : ""}`;
    return nestedCause ? `${base} | cause=${describeCause(nestedCause)}` : base;
  }

  if (typeof cause === "object" && cause !== null) {
    const message = getStringProperty(cause, "message");
    const code = getStringProperty(cause, "code");
    const name = getStringProperty(cause, "name");
    return [name, message, code ? `code=${code}` : null].filter(Boolean).join(" | ") || JSON.stringify(cause);
  }

  return String(cause);
}

function getErrorCause(error: Error): unknown {
  return (error as Error & { cause?: unknown }).cause;
}

function getErrorCode(error: Error): string | undefined {
  return getStringProperty(error, "code") ?? getStringProperty(error, "errno");
}

function getStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return undefined;
  }

  const raw = (value as Record<string, unknown>)[property];
  if (typeof raw === "string" || typeof raw === "number") {
    return String(raw);
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
