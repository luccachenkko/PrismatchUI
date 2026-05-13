import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listDueSchedules,
  listSchedules,
  updateSchedule,
  updateScheduleRunResult,
  upsertProductsFromShopify,
  type ScheduleFrequencyType,
  type ScheduleInput,
  type ScheduleRow,
  type ScheduleScopeType,
  type ScheduleTaskType
} from "./db.js";
import { isPriceRunRunning, startPriceRun, type PriceRunScopeType } from "./priceRuns.js";
import { fetchShopifyCatalogProducts } from "./shopify.js";

const TASK_TYPES = new Set<ScheduleTaskType>([
  "shopify_sync_only",
  "price_match_only",
  "sync_and_price_match",
  "top_products_price_match"
]);
const SCOPE_TYPES = new Set<ScheduleScopeType>(["all_active", "in_stock", "ready"]);
const FREQUENCY_TYPES = new Set<ScheduleFrequencyType>(["daily", "hourly", "weekly"]);
const DEFAULT_TIMEZONE = "Europe/Stockholm";
const DEFAULT_TIME_OF_DAY = "06:00";
const DEFAULT_INTERVAL_HOURS = 6;
const DEFAULT_WEEKDAY = 1;

let schedulerStarted = false;
let schedulerBusy = false;

type ScheduleBody = Partial<Record<keyof ScheduleInput, unknown>>;

export function listScheduleRows(): ScheduleRow[] {
  return listSchedules();
}

export function createScheduleFromBody(body: ScheduleBody): ScheduleRow {
  const input = normalizeScheduleInput(body);
  return createSchedule(input, computeNextRun(input));
}

export function updateScheduleFromBody(scheduleId: number, body: ScheduleBody): ScheduleRow {
  const existing = getSchedule(scheduleId);
  if (!existing) {
    throw new Error("Schemat hittades inte.");
  }

  const input = normalizeScheduleInput({
    name: body.name ?? existing.name,
    task_type: body.task_type ?? existing.task_type,
    scope_type: body.scope_type ?? existing.scope_type,
    frequency_type: body.frequency_type ?? existing.frequency_type,
    time_of_day: body.time_of_day ?? existing.time_of_day,
    interval_hours: body.interval_hours ?? existing.interval_hours,
    weekday: body.weekday ?? existing.weekday,
    timezone: body.timezone ?? existing.timezone,
    enabled: body.enabled ?? Boolean(existing.enabled)
  });

  return updateSchedule(scheduleId, input, computeNextRun(input));
}

export function removeSchedule(scheduleId: number): void {
  deleteSchedule(scheduleId);
}

export async function runScheduleNow(scheduleId: number): Promise<{ schedule: ScheduleRow; run: Awaited<ReturnType<typeof startPriceRun>> | null }> {
  const schedule = getSchedule(scheduleId);
  if (!schedule) {
    throw new Error("Schemat hittades inte.");
  }

  return executeSchedule(schedule);
}

export function startScheduleRunner(): void {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  setTimeout(() => {
    void runDueSchedules();
  }, 1000);
  setInterval(() => {
    void runDueSchedules();
  }, 60_000);
}

export function normalizeScheduleInput(body: ScheduleBody): ScheduleInput {
  const name = normalizeName(body.name);
  const task_type = normalizeEnum(body.task_type, TASK_TYPES, "sync_and_price_match", "task_type");
  const scope_type = normalizeEnum(body.scope_type, SCOPE_TYPES, "ready", "scope_type");
  const frequency_type = normalizeEnum(body.frequency_type, FREQUENCY_TYPES, "daily", "frequency_type");
  const timezone = normalizeTimezone(body.timezone);
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

  let time_of_day: string | null = null;
  let interval_hours: number | null = null;
  let weekday: number | null = null;

  if (frequency_type === "hourly") {
    interval_hours = normalizeInteger(body.interval_hours, DEFAULT_INTERVAL_HOURS, "interval_hours");
    if (interval_hours < 1 || interval_hours > 168) {
      throw new Error("Intervall mÃ¥ste vara mellan 1 och 168 timmar.");
    }
  } else {
    time_of_day = normalizeTimeOfDay(body.time_of_day);
    if (frequency_type === "weekly") {
      weekday = normalizeInteger(body.weekday, DEFAULT_WEEKDAY, "weekday");
      if (weekday < 1 || weekday > 7) {
        throw new Error("Veckodag mÃ¥ste vara 1-7.");
      }
    }
  }

  return {
    name,
    task_type,
    scope_type,
    frequency_type,
    time_of_day,
    interval_hours,
    weekday,
    timezone,
    enabled
  };
}

export function computeNextRun(schedule: Pick<ScheduleInput, "enabled" | "frequency_type" | "time_of_day" | "interval_hours" | "weekday" | "timezone">, from = new Date()): string | null {
  if (!schedule.enabled) {
    return null;
  }

  if (schedule.frequency_type === "hourly") {
    const intervalHours = schedule.interval_hours ?? DEFAULT_INTERVAL_HOURS;
    return new Date(from.getTime() + intervalHours * 60 * 60 * 1000).toISOString();
  }

  const timeOfDay = parseTimeOfDay(schedule.time_of_day ?? DEFAULT_TIME_OF_DAY);
  const timezone = schedule.timezone || DEFAULT_TIMEZONE;
  const localNow = getZonedParts(from, timezone);
  let candidateLocal = {
    year: localNow.year,
    month: localNow.month,
    day: localNow.day,
    hour: timeOfDay.hour,
    minute: timeOfDay.minute
  };

  if (schedule.frequency_type === "weekly") {
    const targetWeekday = schedule.weekday ?? DEFAULT_WEEKDAY;
    const deltaDays = (targetWeekday - localWeekday(candidateLocal.year, candidateLocal.month, candidateLocal.day) + 7) % 7;
    candidateLocal = addLocalDays(candidateLocal, deltaDays);
  }

  let candidate = zonedLocalToUtc(candidateLocal, timezone);
  if (candidate.getTime() <= from.getTime()) {
    candidateLocal = addLocalDays(candidateLocal, schedule.frequency_type === "weekly" ? 7 : 1);
    candidate = zonedLocalToUtc(candidateLocal, timezone);
  }

  return candidate.toISOString();
}

async function runDueSchedules(): Promise<void> {
  if (schedulerBusy) {
    return;
  }

  schedulerBusy = true;
  try {
    const dueSchedules = listDueSchedules(new Date().toISOString());
    for (const schedule of dueSchedules) {
      try {
        console.log(`Running scheduled task #${schedule.id}: ${schedule.name}`);
        await executeSchedule(schedule);
      } catch (error) {
        console.error(`Scheduled task #${schedule.id} failed:`, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    schedulerBusy = false;
  }
}

async function executeSchedule(schedule: ScheduleRow): Promise<{ schedule: ScheduleRow; run: Awaited<ReturnType<typeof startPriceRun>> | null }> {
  const startedAt = new Date().toISOString();
  const wantsPriceRun = schedule.task_type === "price_match_only" || schedule.task_type === "sync_and_price_match";

  try {
    if (schedule.task_type === "top_products_price_match") {
      throw new Error("Topplista/bÃ¤stsÃ¤ljare Ã¤r inte implementerat Ã¤nnu.");
    }

    if (wantsPriceRun && isPriceRunRunning()) {
      throw new Error("En prismatchningskÃ¶rning pÃ¥gÃ¥r redan.");
    }

    if (schedule.task_type === "shopify_sync_only" || schedule.task_type === "sync_and_price_match") {
      const products = await fetchShopifyCatalogProducts();
      upsertProductsFromShopify(products);
    }

    const run = wantsPriceRun ? await startPriceRun({ scopeType: schedule.scope_type as PriceRunScopeType }) : null;
    const updatedSchedule = updateScheduleRunResult(schedule.id, {
      lastRunAt: startedAt,
      lastRunId: run?.id ?? null,
      lastError: null,
      nextRunAt: computeNextRun(rowToInput(schedule), new Date())
    });

    return { schedule: updatedSchedule, run };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateScheduleRunResult(schedule.id, {
      lastRunAt: startedAt,
      lastRunId: null,
      lastError: message,
      nextRunAt: computeNextRun(rowToInput(schedule), new Date())
    });
    throw error;
  }
}

function rowToInput(row: ScheduleRow): ScheduleInput {
  return {
    name: row.name,
    task_type: row.task_type,
    scope_type: row.scope_type,
    frequency_type: row.frequency_type,
    time_of_day: row.time_of_day,
    interval_hours: row.interval_hours,
    weekday: row.weekday,
    timezone: row.timezone,
    enabled: Boolean(row.enabled)
  };
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Namn krÃ¤vs.");
  }

  const name = value.trim();
  if (!name) {
    throw new Error("Namn krÃ¤vs.");
  }

  if (name.length > 120) {
    throw new Error("Namn fÃ¥r vara max 120 tecken.");
  }

  return name;
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T, fieldName: string): T {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "string" && allowed.has(value as T)) {
    return value as T;
  }

  throw new Error(`Ogiltigt vÃ¤rde fÃ¶r ${fieldName}.`);
}

function normalizeTimezone(value: unknown): string {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("Ogiltig timezone.");
  }
  return timezone;
}

function normalizeTimeOfDay(value: unknown): string {
  const time = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TIME_OF_DAY;
  parseTimeOfDay(time);
  return time;
}

function normalizeInteger(value: unknown, fallback: number, fieldName: string): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(numberValue)) {
    throw new Error(`${fieldName} mÃ¥ste vara ett heltal.`);
  }
  return numberValue;
}

function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("Tid mÃ¥ste anges som HH:MM.");
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Tid mÃ¥ste anges som HH:MM.");
  }

  return { hour, minute };
}

function getZonedParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function zonedLocalToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string
): Date {
  const guess = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute));
  const actual = getZonedParts(guess, timezone);
  const expectedUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
  return new Date(guess.getTime() + (expectedUtc - actualUtc));
}

function addLocalDays<T extends { year: number; month: number; day: number; hour: number; minute: number }>(
  local: T,
  days: number
): T {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days, local.hour, local.minute));
  return {
    ...local,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function localWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
