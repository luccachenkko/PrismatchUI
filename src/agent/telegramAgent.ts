import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentClient } from "./agentClient.js";
import { handleTelegramCommand, isWhoamiCommand } from "./telegramCommands.js";
import type { TelegramApiResponse, TelegramUpdate } from "./telegramTypes.js";
import { loadDotEnv } from "../env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

loadDotEnv(path.join(projectRoot, ".env"));

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
const apiBaseUrl = process.env.AGENT_API_BASE_URL?.trim() || "http://localhost:3000";
const dryRun = parseBoolean(process.env.AGENT_DRY_RUN, true);

if (!botToken) {
  console.error("TELEGRAM_BOT_TOKEN saknas i .env");
  process.exitCode = 1;
} else {
  const client = new AgentClient(apiBaseUrl);
  void startPolling({ botToken, allowedChatIds, client, dryRun });
}

async function startPolling(options: {
  botToken: string;
  allowedChatIds: Set<string>;
  client: AgentClient;
  dryRun: boolean;
}): Promise<void> {
  let offset = 0;
  console.log("Telegram-agent startad med long polling.");

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
      console.error(`Telegram-agentfel: ${safeErrorMessage(error)}`);
      await sleep(3000);
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
  }
): Promise<void> {
  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text || !text.startsWith("/")) {
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
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const payload = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram API svarade HTTP ${response.status}.`);
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

function limitTelegramMessage(text: string): string {
  if (text.length <= 3900) {
    return text;
  }

  return `${text.slice(0, 3890)}\n...`;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
