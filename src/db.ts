import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { extractDomainFromUrl, hasSupportedScraper } from "./scraperSupport.js";
import type { ShopifyCatalogProduct } from "./types.js";
import type { VatMode } from "./vat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultDbPath = path.join(projectRoot, "data", "prismatch.sqlite");

export type ProductRow = {
  id: number;
  shopify_product_id: string;
  shopify_variant_id: string;
  sku: string | null;
  title: string;
  vendor: string | null;
  product_type: string | null;
  barcode: string | null;
  shopify_price: number;
  inventory_quantity: number;
  active: number;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
  cost_price: number | null;
  cost_price_vat_mode: VatMode | null;
  sales_price_vat_mode: VatMode | null;
  vat_percent: number | null;
  min_margin_percent: number | null;
  undercut_amount: number | null;
  pricing_enabled: number | null;
  competitor_link_count: number;
  last_checked_at: string | null;
};

export type DashboardStats = {
  productCount: number;
  inStockCount: number;
  missingCostPriceCount: number;
  missingCompetitorLinksCount: number;
  latestRun: string | null;
  okRecommendationCount: number;
  blockedRecommendationCount: number;
  errorRecommendationCount: number;
};

export type PricingRuleRow = {
  id: number;
  product_id: number;
  cost_price: number | null;
  cost_price_vat_mode: VatMode;
  sales_price_vat_mode: VatMode;
  vat_percent: number;
  min_margin_percent: number | null;
  undercut_amount: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type CompetitorLinkRow = {
  id: number;
  product_id: number;
  url: string;
  domain: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_price: number | null;
  last_status: string | null;
  last_error: string | null;
  scraper_supported: boolean;
};

export type ProductDetail = {
  product: Omit<
    ProductRow,
    | "cost_price"
    | "cost_price_vat_mode"
    | "sales_price_vat_mode"
    | "vat_percent"
    | "min_margin_percent"
    | "undercut_amount"
    | "pricing_enabled"
    | "competitor_link_count"
    | "last_checked_at"
  >;
  pricingRule: PricingRuleRow | null;
  competitorLinks: CompetitorLinkRow[];
};

export type PricingRuleInput = {
  cost_price: number | null;
  cost_price_vat_mode: VatMode;
  sales_price_vat_mode: VatMode;
  vat_percent: number;
  min_margin_percent: number | null;
  undercut_amount: number | null;
  enabled: boolean;
};

export type CompetitorLinkInput = {
  url: string;
  enabled: boolean;
};

export type ScheduleTaskType =
  | "shopify_sync_only"
  | "price_match_only"
  | "sync_and_price_match"
  | "top_products_price_match";

export type ScheduleScopeType = "all_active" | "in_stock" | "ready";

export type ScheduleFrequencyType = "daily" | "hourly" | "weekly";

export type ScheduleRow = {
  id: number;
  name: string;
  task_type: ScheduleTaskType;
  scope_type: ScheduleScopeType;
  frequency_type: ScheduleFrequencyType;
  time_of_day: string | null;
  interval_hours: number | null;
  weekday: number | null;
  timezone: string;
  enabled: number;
  last_run_at: string | null;
  last_run_id: number | null;
  last_error: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  latest_report_status?: string | null;
};

export type ScheduleInput = {
  name: string;
  task_type: ScheduleTaskType;
  scope_type: ScheduleScopeType;
  frequency_type: ScheduleFrequencyType;
  time_of_day: string | null;
  interval_hours: number | null;
  weekday: number | null;
  timezone: string;
  enabled: boolean;
};

export type AgentScraperJobStatus =
  | "created"
  | "awaiting_codegen"
  | "generating"
  | "testing"
  | "awaiting_user_approval"
  | "approved"
  | "rejected"
  | "failed";

export type AgentScraperJobRow = {
  id: number;
  chat_id: string;
  sku: string | null;
  url: string;
  domain: string;
  status: AgentScraperJobStatus;
  codex_prompt: string | null;
  test_output: string | null;
  result_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentScraperJobEventRow = {
  id: number;
  job_id: number;
  level: string;
  message: string;
  data_json: string | null;
  created_at: string;
};

export type AgentScraperJobInput = {
  chatId: string;
  sku?: string | null;
  url: string;
  domain: string;
  status: AgentScraperJobStatus;
  codexPrompt?: string | null;
  testOutput?: string | null;
  resultSummary?: string | null;
};

let db: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (db) {
    return db;
  }

  const dbPath = process.env.PRISMATCH_DB_PATH?.trim() || defaultDbPath;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function listProducts(): ProductRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        p.*,
        r.cost_price,
        r.cost_price_vat_mode,
        r.sales_price_vat_mode,
        r.vat_percent,
        r.min_margin_percent,
        r.undercut_amount,
        r.enabled AS pricing_enabled,
        COUNT(c.id) AS competitor_link_count,
        MAX(c.last_checked_at) AS last_checked_at
      FROM products p
      LEFT JOIN pricing_rules r ON r.product_id = p.id
      LEFT JOIN competitor_links c ON c.product_id = p.id AND c.enabled = 1
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id DESC
      `
    )
    .all() as ProductRow[];
}

export function getDashboardStats(): DashboardStats {
  const database = getDatabase();
  const productStats = database
    .prepare(
      `
      SELECT
        COUNT(*) AS productCount,
        COALESCE(SUM(CASE WHEN inventory_quantity > 0 THEN 1 ELSE 0 END), 0) AS inStockCount,
        COALESCE(SUM(CASE WHEN r.cost_price IS NULL THEN 1 ELSE 0 END), 0) AS missingCostPriceCount,
        COALESCE(SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM competitor_links c WHERE c.product_id = p.id AND c.enabled = 1
        ) THEN 1 ELSE 0 END), 0) AS missingCompetitorLinksCount
      FROM products p
      LEFT JOIN pricing_rules r ON r.product_id = p.id
      `
    )
    .get() as Record<string, number> | undefined;

  const latestRun = database
    .prepare("SELECT started_at FROM price_runs ORDER BY started_at DESC LIMIT 1")
    .get() as { started_at: string } | undefined;

  const recommendationStats = database
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END), 0) AS okRecommendationCount,
        COALESCE(SUM(CASE WHEN status LIKE 'BLOCKERAD%' THEN 1 ELSE 0 END), 0) AS blockedRecommendationCount,
        COALESCE(SUM(CASE WHEN status NOT IN ('OK', 'INGEN_ANDRING') AND status NOT LIKE 'BLOCKERAD%' THEN 1 ELSE 0 END), 0) AS errorRecommendationCount
      FROM price_recommendations
      WHERE run_id = (SELECT id FROM price_runs ORDER BY started_at DESC LIMIT 1)
      `
    )
    .get() as Record<string, number> | undefined;

  return {
    productCount: productStats?.productCount ?? 0,
    inStockCount: productStats?.inStockCount ?? 0,
    missingCostPriceCount: productStats?.missingCostPriceCount ?? 0,
    missingCompetitorLinksCount: productStats?.missingCompetitorLinksCount ?? 0,
    latestRun: latestRun?.started_at ?? null,
    okRecommendationCount: recommendationStats?.okRecommendationCount ?? 0,
    blockedRecommendationCount: recommendationStats?.blockedRecommendationCount ?? 0,
    errorRecommendationCount: recommendationStats?.errorRecommendationCount ?? 0
  };
}

export function getProductDetail(productId: number): ProductDetail | null {
  const database = getDatabase();
  const product = database.prepare("SELECT * FROM products WHERE id = ?").get(productId) as
    | ProductDetail["product"]
    | undefined;

  if (!product) {
    return null;
  }

  const pricingRule = database.prepare("SELECT * FROM pricing_rules WHERE product_id = ?").get(productId) as
    | PricingRuleRow
    | undefined;

  const competitorLinks = database
    .prepare("SELECT * FROM competitor_links WHERE product_id = ? ORDER BY enabled DESC, updated_at DESC, id DESC")
    .all(productId)
    .map((row) => {
      const link = row as Omit<CompetitorLinkRow, "scraper_supported">;
      return {
        ...link,
        scraper_supported: hasSupportedScraper(link.domain)
      };
    });

  return {
    product,
    pricingRule: pricingRule ?? null,
    competitorLinks
  };
}

export function upsertPricingRule(productId: number, input: PricingRuleInput): PricingRuleRow {
  assertProductExists(productId);
  validatePricingRule(input);

  const database = getDatabase();
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO pricing_rules (
        product_id,
        cost_price,
        cost_price_vat_mode,
        sales_price_vat_mode,
        vat_percent,
        min_margin_percent,
        undercut_amount,
        enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        cost_price = excluded.cost_price,
        cost_price_vat_mode = excluded.cost_price_vat_mode,
        sales_price_vat_mode = excluded.sales_price_vat_mode,
        vat_percent = excluded.vat_percent,
        min_margin_percent = excluded.min_margin_percent,
        undercut_amount = excluded.undercut_amount,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
      `
    )
    .run(
      productId,
      input.cost_price,
      input.cost_price_vat_mode,
      input.sales_price_vat_mode,
      input.vat_percent,
      input.min_margin_percent,
      input.undercut_amount,
      input.enabled ? 1 : 0,
      now,
      now
    );

  return database.prepare("SELECT * FROM pricing_rules WHERE product_id = ?").get(productId) as PricingRuleRow;
}

export function createCompetitorLink(productId: number, input: CompetitorLinkInput): CompetitorLinkRow {
  assertProductExists(productId);
  const url = input.url.trim();
  const domain = extractDomainFromUrl(url);
  const now = new Date().toISOString();
  const database = getDatabase();

  const result = database
    .prepare(
      `
      INSERT INTO competitor_links (
        product_id,
        url,
        domain,
        enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .run(productId, url, domain, input.enabled ? 1 : 0, now, now);

  return getCompetitorLink(Number(result.lastInsertRowid));
}

export function updateCompetitorLink(linkId: number, input: CompetitorLinkInput): CompetitorLinkRow {
  const existing = getCompetitorLinkOrNull(linkId);
  if (!existing) {
    throw new Error("Konkurrentlänken hittades inte.");
  }

  const url = input.url.trim();
  const domain = extractDomainFromUrl(url);
  getDatabase()
    .prepare(
      `
      UPDATE competitor_links
      SET url = ?, domain = ?, enabled = ?, updated_at = ?
      WHERE id = ?
      `
    )
    .run(url, domain, input.enabled ? 1 : 0, new Date().toISOString(), linkId);

  return getCompetitorLink(linkId);
}

export function deleteCompetitorLink(linkId: number): void {
  const result = getDatabase().prepare("DELETE FROM competitor_links WHERE id = ?").run(linkId);
  if (Number(result.changes) === 0) {
    throw new Error("Konkurrentlänken hittades inte.");
  }
}

export function listSchedules(): ScheduleRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.*,
        pr.status AS latest_report_status
      FROM schedules s
      LEFT JOIN price_runs pr ON pr.id = s.last_run_id
      ORDER BY s.enabled DESC, COALESCE(s.next_run_at, '9999-12-31') ASC, s.updated_at DESC
      `
    )
    .all() as ScheduleRow[];
}

export function getSchedule(scheduleId: number): ScheduleRow | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT
        s.*,
        pr.status AS latest_report_status
      FROM schedules s
      LEFT JOIN price_runs pr ON pr.id = s.last_run_id
      WHERE s.id = ?
      `
    )
    .get(scheduleId) as ScheduleRow | undefined;
  return row ?? null;
}

export function createSchedule(input: ScheduleInput, nextRunAt: string | null): ScheduleRow {
  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `
      INSERT INTO schedules (
        name,
        task_type,
        scope_type,
        frequency_type,
        time_of_day,
        interval_hours,
        weekday,
        timezone,
        enabled,
        next_run_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      input.name,
      input.task_type,
      input.scope_type,
      input.frequency_type,
      input.time_of_day,
      input.interval_hours,
      input.weekday,
      input.timezone,
      input.enabled ? 1 : 0,
      nextRunAt,
      now,
      now
    );

  return getSchedule(Number(result.lastInsertRowid)) as ScheduleRow;
}

export function updateSchedule(scheduleId: number, input: ScheduleInput, nextRunAt: string | null): ScheduleRow {
  const result = getDatabase()
    .prepare(
      `
      UPDATE schedules
      SET
        name = ?,
        task_type = ?,
        scope_type = ?,
        frequency_type = ?,
        time_of_day = ?,
        interval_hours = ?,
        weekday = ?,
        timezone = ?,
        enabled = ?,
        next_run_at = ?,
        updated_at = ?
      WHERE id = ?
      `
    )
    .run(
      input.name,
      input.task_type,
      input.scope_type,
      input.frequency_type,
      input.time_of_day,
      input.interval_hours,
      input.weekday,
      input.timezone,
      input.enabled ? 1 : 0,
      nextRunAt,
      new Date().toISOString(),
      scheduleId
    );

  if (Number(result.changes) === 0) {
    throw new Error("Schemat hittades inte.");
  }

  return getSchedule(scheduleId) as ScheduleRow;
}

export function deleteSchedule(scheduleId: number): void {
  const result = getDatabase().prepare("DELETE FROM schedules WHERE id = ?").run(scheduleId);
  if (Number(result.changes) === 0) {
    throw new Error("Schemat hittades inte.");
  }
}

export function listDueSchedules(nowIso: string): ScheduleRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT *
      FROM schedules
      WHERE enabled = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC, id ASC
      `
    )
    .all(nowIso) as ScheduleRow[];
}

export function updateScheduleRunResult(
  scheduleId: number,
  result: { lastRunAt: string; lastRunId: number | null; lastError: string | null; nextRunAt: string | null }
): ScheduleRow {
  getDatabase()
    .prepare(
      `
      UPDATE schedules
      SET
        last_run_at = ?,
        last_run_id = ?,
        last_error = ?,
        next_run_at = ?,
        updated_at = ?
      WHERE id = ?
      `
    )
    .run(
      result.lastRunAt,
      result.lastRunId,
      result.lastError,
      result.nextRunAt,
      new Date().toISOString(),
      scheduleId
    );

  return getSchedule(scheduleId) as ScheduleRow;
}

export function createAgentScraperJob(input: AgentScraperJobInput): AgentScraperJobRow {
  const now = new Date().toISOString();
  const database = getDatabase();
  const result = database
    .prepare(
      `
      INSERT INTO agent_scraper_jobs (
        chat_id,
        sku,
        url,
        domain,
        status,
        codex_prompt,
        test_output,
        result_summary,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      input.chatId,
      input.sku ?? null,
      input.url,
      input.domain,
      input.status,
      input.codexPrompt ?? null,
      input.testOutput ?? null,
      input.resultSummary ?? null,
      now,
      now
    );

  const jobId = Number(result.lastInsertRowid);
  addAgentScraperJobEvent(jobId, "info", "Scraper-jobb skapat.", { status: input.status, domain: input.domain });
  return getAgentScraperJob(jobId) as AgentScraperJobRow;
}

export function listAgentScraperJobs(limit = 10): AgentScraperJobRow[] {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
  return getDatabase()
    .prepare(
      `
      SELECT *
      FROM agent_scraper_jobs
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `
    )
    .all(safeLimit) as AgentScraperJobRow[];
}

export function getAgentScraperJob(jobId: number): AgentScraperJobRow | null {
  const row = getDatabase().prepare("SELECT * FROM agent_scraper_jobs WHERE id = ?").get(jobId) as
    | AgentScraperJobRow
    | undefined;
  return row ?? null;
}

export function addAgentScraperJobEvent(
  jobId: number,
  level: string,
  message: string,
  data: Record<string, unknown> | null = null
): AgentScraperJobEventRow {
  const result = getDatabase()
    .prepare(
      `
      INSERT INTO agent_scraper_job_events (
        job_id,
        level,
        message,
        data_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(jobId, level, message, data ? JSON.stringify(data) : null, new Date().toISOString());

  const event = getDatabase()
    .prepare("SELECT * FROM agent_scraper_job_events WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as AgentScraperJobEventRow | undefined;

  if (!event) {
    throw new Error("Scraper-jobbevent kunde inte hittas efter skapande.");
  }

  return event;
}

export function upsertProductsFromShopify(products: ShopifyCatalogProduct[]): number {
  const database = getDatabase();
  const now = new Date().toISOString();
  const insert = database.prepare(
    `
    INSERT INTO products (
      shopify_product_id,
      shopify_variant_id,
      sku,
      title,
      vendor,
      product_type,
      barcode,
      shopify_price,
      inventory_quantity,
      active,
      last_synced_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shopify_variant_id) DO UPDATE SET
      shopify_product_id = excluded.shopify_product_id,
      sku = excluded.sku,
      title = excluded.title,
      vendor = excluded.vendor,
      product_type = excluded.product_type,
      barcode = excluded.barcode,
      shopify_price = excluded.shopify_price,
      inventory_quantity = excluded.inventory_quantity,
      active = excluded.active,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
    `
  );

  database.exec("BEGIN");
  try {
    for (const product of products) {
      insert.run(
        product.shopifyProductId,
        product.shopifyVariantId,
        product.sku,
        product.title,
        product.vendor,
        product.productType,
        product.barcode,
        product.shopifyPrice,
        product.inventoryQuantity,
        product.active ? 1 : 0,
        now,
        now,
        now
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return products.length;
}

function assertProductExists(productId: number): void {
  const product = getDatabase().prepare("SELECT id FROM products WHERE id = ?").get(productId);
  if (!product) {
    throw new Error("Produkten hittades inte.");
  }
}

function getCompetitorLink(linkId: number): CompetitorLinkRow {
  const link = getCompetitorLinkOrNull(linkId);
  if (!link) {
    throw new Error("Konkurrentlänken hittades inte.");
  }
  return link;
}

function getCompetitorLinkOrNull(linkId: number): CompetitorLinkRow | null {
  const row = getDatabase().prepare("SELECT * FROM competitor_links WHERE id = ?").get(linkId) as
    | Omit<CompetitorLinkRow, "scraper_supported">
    | undefined;

  if (!row) {
    return null;
  }

  return {
    ...row,
    scraper_supported: hasSupportedScraper(row.domain)
  };
}

function validatePricingRule(input: PricingRuleInput): void {
  validateOptionalNonNegativeNumber(input.cost_price, "Inköpspris");
  validateVatMode(input.cost_price_vat_mode, "Inköpsprisets momsbas");
  validateVatMode(input.sales_price_vat_mode, "Försäljningsprisets momsbas");
  validateOptionalNonNegativeNumber(input.vat_percent, "Moms %");
  validateOptionalNonNegativeNumber(input.min_margin_percent, "Min TB1 %");
  validateOptionalNonNegativeNumber(input.undercut_amount, "Undercut kr");

  if (input.vat_percent > 100) {
    throw new Error("Moms % måste vara 100 eller lägre.");
  }

  if (input.min_margin_percent !== null && input.min_margin_percent >= 100) {
    throw new Error("Min TB1 % måste vara under 100.");
  }
}

function validateVatMode(value: VatMode, label: string): void {
  if (value !== "ex_vat" && value !== "inc_vat") {
    throw new Error(`${label} måste vara ex_vat eller inc_vat.`);
  }
}

function validateOptionalNonNegativeNumber(value: number | null, label: string): void {
  if (value === null) {
    return;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} måste vara ett tal som är 0 eller högre.`);
  }
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_product_id TEXT NOT NULL,
      shopify_variant_id TEXT NOT NULL UNIQUE,
      sku TEXT,
      title TEXT NOT NULL,
      vendor TEXT,
      product_type TEXT,
      barcode TEXT,
      shopify_price REAL NOT NULL,
      inventory_quantity INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE,
      cost_price REAL,
      cost_price_vat_mode TEXT NOT NULL DEFAULT 'ex_vat',
      sales_price_vat_mode TEXT NOT NULL DEFAULT 'inc_vat',
      vat_percent REAL NOT NULL DEFAULT 25,
      min_margin_percent REAL,
      undercut_amount REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS competitor_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_checked_at TEXT,
      last_price REAL,
      last_status TEXT,
      last_error TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS price_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      total_products INTEGER NOT NULL DEFAULT 0,
      products_skipped_no_stock INTEGER NOT NULL DEFAULT 0,
      total_links_checked INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      competitor_link_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      price REAL,
      status TEXT NOT NULL,
      error TEXT,
      fetched_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES price_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (competitor_link_id) REFERENCES competitor_links(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS price_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      shopify_price_before REAL,
      cheapest_competitor_domain TEXT,
      cheapest_competitor_url TEXT,
      cheapest_competitor_price REAL,
      suggested_price REAL,
      cost_price REAL,
      cost_price_inc_vat REAL,
      cost_price_ex_vat REAL,
      cost_price_vat_mode TEXT NOT NULL DEFAULT 'ex_vat',
      sales_price_vat_mode TEXT NOT NULL DEFAULT 'inc_vat',
      vat_percent REAL NOT NULL DEFAULT 25,
      shopify_price_inc_vat REAL,
      shopify_price_ex_vat REAL,
      shopify_price_vat_mode TEXT NOT NULL DEFAULT 'inc_vat',
      cheapest_competitor_price_inc_vat REAL,
      cheapest_competitor_price_ex_vat REAL,
      suggested_price_inc_vat REAL,
      suggested_price_ex_vat REAL,
      min_margin_percent REAL,
      min_allowed_price REAL,
      min_allowed_price_inc_vat REAL,
      min_allowed_price_ex_vat REAL,
      tb1_amount REAL,
      tb1_percent REAL,
      margin_after_percent REAL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES price_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shopify_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      shopify_variant_id TEXT NOT NULL,
      old_price REAL NOT NULL,
      new_price REAL NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (recommendation_id) REFERENCES price_recommendations(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      task_type TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      frequency_type TEXT NOT NULL,
      time_of_day TEXT,
      interval_hours INTEGER,
      weekday INTEGER,
      timezone TEXT NOT NULL DEFAULT 'Europe/Stockholm',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_run_id INTEGER,
      last_error TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (last_run_id) REFERENCES price_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_schedules_due
      ON schedules(enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS agent_scraper_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      sku TEXT,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      status TEXT NOT NULL,
      codex_prompt TEXT,
      test_output TEXT,
      result_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_scraper_job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES agent_scraper_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_scraper_jobs_created
      ON agent_scraper_jobs(created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_scraper_job_events_job
      ON agent_scraper_job_events(job_id, created_at ASC);
  `);

  ensureColumn(database, "pricing_rules", "cost_price_vat_mode", "TEXT NOT NULL DEFAULT 'ex_vat'");
  ensureColumn(database, "pricing_rules", "sales_price_vat_mode", "TEXT NOT NULL DEFAULT 'inc_vat'");
  ensureColumn(database, "pricing_rules", "vat_percent", "REAL NOT NULL DEFAULT 25");

  ensureColumn(database, "price_recommendations", "cost_price_inc_vat", "REAL");
  ensureColumn(database, "price_recommendations", "cost_price_ex_vat", "REAL");
  ensureColumn(database, "price_recommendations", "cost_price_vat_mode", "TEXT NOT NULL DEFAULT 'ex_vat'");
  ensureColumn(database, "price_recommendations", "sales_price_vat_mode", "TEXT NOT NULL DEFAULT 'inc_vat'");
  ensureColumn(database, "price_recommendations", "vat_percent", "REAL NOT NULL DEFAULT 25");
  ensureColumn(database, "price_recommendations", "shopify_price_inc_vat", "REAL");
  ensureColumn(database, "price_recommendations", "shopify_price_ex_vat", "REAL");
  ensureColumn(database, "price_recommendations", "shopify_price_vat_mode", "TEXT NOT NULL DEFAULT 'inc_vat'");
  ensureColumn(database, "price_recommendations", "cheapest_competitor_price_inc_vat", "REAL");
  ensureColumn(database, "price_recommendations", "cheapest_competitor_price_ex_vat", "REAL");
  ensureColumn(database, "price_recommendations", "suggested_price_inc_vat", "REAL");
  ensureColumn(database, "price_recommendations", "suggested_price_ex_vat", "REAL");
  ensureColumn(database, "price_recommendations", "min_allowed_price_inc_vat", "REAL");
  ensureColumn(database, "price_recommendations", "min_allowed_price_ex_vat", "REAL");
  ensureColumn(database, "price_recommendations", "tb1_amount", "REAL");
  ensureColumn(database, "price_recommendations", "tb1_percent", "REAL");

  database.exec(`
    UPDATE pricing_rules
    SET cost_price_vat_mode = 'ex_vat'
    WHERE cost_price_vat_mode IS NULL OR cost_price_vat_mode NOT IN ('ex_vat', 'inc_vat');

    UPDATE pricing_rules
    SET sales_price_vat_mode = 'inc_vat'
    WHERE sales_price_vat_mode IS NULL OR sales_price_vat_mode NOT IN ('ex_vat', 'inc_vat');

    UPDATE pricing_rules
    SET vat_percent = 25
    WHERE vat_percent IS NULL;

    UPDATE price_recommendations
    SET cost_price_vat_mode = 'ex_vat'
    WHERE cost_price_vat_mode IS NULL OR cost_price_vat_mode NOT IN ('ex_vat', 'inc_vat');

    UPDATE price_recommendations
    SET sales_price_vat_mode = 'inc_vat'
    WHERE sales_price_vat_mode IS NULL OR sales_price_vat_mode NOT IN ('ex_vat', 'inc_vat');

    UPDATE price_recommendations
    SET shopify_price_vat_mode = sales_price_vat_mode
    WHERE shopify_price_vat_mode IS NULL OR shopify_price_vat_mode NOT IN ('ex_vat', 'inc_vat');

    UPDATE price_recommendations
    SET vat_percent = 25
    WHERE vat_percent IS NULL;
  `);
}

function ensureColumn(database: DatabaseSync, tableName: string, columnName: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}
