import { getEnvNumber } from "./env.js";
import { mapWithConcurrency } from "./concurrency.js";
import { getDatabase, type CompetitorLinkRow, type PricingRuleRow } from "./db.js";
import { roundMoney } from "./money.js";
import { scrapePriceForLink } from "./scrapers/index.js";
import { fetchShopifyVariantStatesByVariantIds, updateShopifyPrices } from "./shopify.js";
import {
  calculateMinAllowedPrice,
  calculateTb1,
  toExVat,
  toIncVat,
  type VatMode
} from "./vat.js";
import type {
  LinkInput,
  RecommendationStatus,
  ScrapedPriceResult,
  ShopifyUpdateRequest,
  ShopifyVariantState
} from "./types.js";

type RunProductRow = {
  id: number;
  shopify_product_id: string;
  shopify_variant_id: string;
  sku: string | null;
  title: string;
  vendor: string | null;
  product_type: string | null;
  barcode: string | null;
  inventory_quantity: number;
  active: number;
};

type RunProduct = {
  product: RunProductRow;
  pricingRule: PricingRuleRow | null;
  competitorLinks: CompetitorLinkRow[];
};

type PriceJob = {
  product: RunProductRow;
  link: CompetitorLinkRow;
  sku: string;
};

type RecommendationInput = {
  runId: number;
  product: RunProductRow;
  pricingRule: PricingRuleRow | null;
  shopifyState: ShopifyVariantState | null;
  shopifyError?: string;
  snapshots: StoredSnapshot[];
  createdAt: string;
};

type StoredSnapshot = {
  id: number;
  run_id: number;
  product_id: number;
  competitor_link_id: number;
  url: string;
  domain: string;
  price: number | null;
  status: "success" | "failed";
  error: string | null;
  fetched_at: string;
};

type RecommendationRow = {
  id: number;
  run_id: number;
  product_id: number;
  sku: string | null;
  title: string;
  inventory_quantity: number;
  last_synced_at: string;
  shopify_price_before: number | null;
  shopify_price_inc_vat: number | null;
  shopify_price_ex_vat: number | null;
  shopify_price_vat_mode: VatMode;
  cheapest_competitor_domain: string | null;
  cheapest_competitor_url: string | null;
  cheapest_competitor_price: number | null;
  cheapest_competitor_price_inc_vat: number | null;
  cheapest_competitor_price_ex_vat: number | null;
  suggested_price: number | null;
  suggested_price_inc_vat: number | null;
  suggested_price_ex_vat: number | null;
  cost_price: number | null;
  cost_price_inc_vat: number | null;
  cost_price_ex_vat: number | null;
  cost_price_vat_mode: VatMode;
  sales_price_vat_mode: VatMode;
  vat_percent: number;
  min_margin_percent: number | null;
  min_allowed_price: number | null;
  min_allowed_price_inc_vat: number | null;
  min_allowed_price_ex_vat: number | null;
  tb1_amount: number | null;
  tb1_percent: number | null;
  margin_after_percent: number | null;
  status: RecommendationStatus;
  reason: string;
  approved: number;
  created_at: string;
  shopify_update_status?: ShopifyUpdateStatus;
  shopify_update_error?: string | null;
  shopify_update_at?: string | null;
};

type RecommendationForUpdate = RecommendationRow & {
  shopify_product_id: string;
  shopify_variant_id: string;
};

type PriceRunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "completed" | "failed";
  total_products: number;
  products_skipped_no_stock: number;
  total_links_checked: number;
  success_count: number;
  error_count: number;
  created_at: string;
};

type ShopifyUpdateStatus = "not_updated" | "success" | "failed" | "skipped_already_updated";

type ShopifyUpdateLogRow = {
  id: number;
  recommendation_id: number;
  product_id: number;
  shopify_variant_id: string;
  old_price: number;
  new_price: number;
  status: ShopifyUpdateStatus;
  error: string | null;
  updated_at: string;
  sku?: string | null;
  title?: string;
};

type ApplyApprovedResult = {
  recommendation_id: number;
  product_id: number;
  shopify_variant_id: string | null;
  old_price: number | null;
  new_price: number | null;
  status: ShopifyUpdateStatus;
  error: string | null;
};

export type PriceRunScopeType = "all_active" | "in_stock" | "ready";

let runningInProcess = false;

export async function startPriceRun(options: { scopeType?: PriceRunScopeType } = {}): Promise<PriceRunRow> {
  if (runningInProcess || hasRunningPriceRun()) {
    throw new Error("En prismatchningskörning pågår redan.");
  }

  runningInProcess = true;
  const startedAt = new Date().toISOString();
  const runId = createRun(startedAt);

  try {
    const runProducts = loadRunProducts(options.scopeType ?? "all");
    updateRunTotals(runId, { total_products: runProducts.length });

    console.log("Refreshing Shopify price and inventory before price run...");
    const variantStates = await fetchShopifyVariantStatesByVariantIds(
      runProducts.map((item) => item.product.shopify_variant_id)
    );
    const refreshStats = updateProductsFromShopifyStates(runProducts, variantStates);

    const eligibleProducts: RunProduct[] = [];
    let shopifyErrorCount = 0;
    let skippedNoStockCount = 0;
    for (const item of runProducts) {
      const state = variantStates.get(item.product.shopify_variant_id) ?? null;
      if (!state) {
        shopifyErrorCount += 1;
        insertRecommendation(
          buildRecommendation({
            runId,
            product: item.product,
            pricingRule: item.pricingRule,
            shopifyState: null,
            shopifyError: "Shopify returnerade ingen variant fÃ¶r sparat shopify_variant_id.",
            snapshots: [],
            createdAt: new Date().toISOString()
          })
        );
        continue;
      }

      if (item.product.active !== 1 || (item.pricingRule && item.pricingRule.enabled !== 1)) {
        insertRecommendation(
          buildRecommendation({
            runId,
            product: item.product,
            pricingRule: item.pricingRule,
            shopifyState: state,
            snapshots: [],
            createdAt: new Date().toISOString()
          })
        );
        continue;
      }

      if (!state) {
        shopifyErrorCount += 1;
        insertRecommendation(
          buildRecommendation({
            runId,
            product: item.product,
            pricingRule: item.pricingRule,
            shopifyState: null,
            shopifyError: "Shopify returnerade ingen variant för sparat shopify_variant_id.",
            snapshots: [],
            createdAt: new Date().toISOString()
          })
        );
        continue;
      }

      if (state.inventoryQuantity <= 0) {
        skippedNoStockCount += 1;
        insertRecommendation(
          buildRecommendation({
            runId,
            product: item.product,
            pricingRule: item.pricingRule,
            shopifyState: state,
            snapshots: [],
            createdAt: new Date().toISOString()
          })
        );
        continue;
      }

      if (!item.pricingRule || item.pricingRule.cost_price === null) {
        insertRecommendation(
          buildRecommendation({
            runId,
            product: item.product,
            pricingRule: item.pricingRule,
            shopifyState: state,
            snapshots: [],
            createdAt: new Date().toISOString()
          })
        );
        continue;
      }

      if (item.competitorLinks.length === 0) {
        insertRecommendation(
          buildRecommendation({
            runId,
            product: item.product,
            pricingRule: item.pricingRule,
            shopifyState: state,
            snapshots: [],
            createdAt: new Date().toISOString()
          })
        );
        continue;
      }

      eligibleProducts.push(item);
    }

    console.log(`Shopify refresh updated ${refreshStats.updatedCount} products.`);
    console.log(`Shopify refresh product errors: ${shopifyErrorCount}.`);
    console.log(`Products skipped because own Shopify inventory is 0: ${skippedNoStockCount}.`);

    const priceJobs = eligibleProducts.flatMap((item) =>
      item.competitorLinks.map((link) => ({
        product: item.product,
        link,
        sku: item.product.sku || item.product.shopify_variant_id
      }))
    );

    const snapshotsByProductId = new Map<number, StoredSnapshot[]>();
    const concurrency = getEnvNumber("PRICE_FETCH_CONCURRENCY", 5);
    await mapWithConcurrency(priceJobs, concurrency, async (job) => {
      const scraped = await scrapePriceForLink({ sku: job.sku, url: job.link.url, aktiv: true } satisfies LinkInput);
      const snapshot = insertSnapshot(runId, job, scraped);
      updateCompetitorLinkAfterScrape(job.link.id, snapshot);
      const existing = snapshotsByProductId.get(job.product.id) ?? [];
      existing.push(snapshot);
      snapshotsByProductId.set(job.product.id, existing);
      return snapshot;
    });

    for (const item of eligibleProducts) {
      insertRecommendation(
        buildRecommendation({
          runId,
          product: item.product,
          pricingRule: item.pricingRule,
          shopifyState: variantStates.get(item.product.shopify_variant_id) ?? null,
          snapshots: snapshotsByProductId.get(item.product.id) ?? [],
          createdAt: new Date().toISOString()
        })
      );
    }

    completeRun(runId, "completed");
  } catch (error) {
    completeRun(runId, "failed");
    throw error;
  } finally {
    runningInProcess = false;
  }

  return getPriceRunRow(runId);
}

export function isPriceRunRunning(): boolean {
  return runningInProcess || hasRunningPriceRun();
}

export function listPriceRuns(): PriceRunRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT *
      FROM price_runs
      ORDER BY started_at DESC, id DESC
      `
    )
    .all() as PriceRunRow[];
}

export function getPriceRunReport(runId: number): {
  run: PriceRunRow;
  recommendations: RecommendationRow[];
  snapshots: StoredSnapshot[];
  errors: StoredSnapshot[];
  shopifyUpdates: ShopifyUpdateLogRow[];
} | null {
  const run = getDatabase().prepare("SELECT * FROM price_runs WHERE id = ?").get(runId) as PriceRunRow | undefined;
  if (!run) {
    return null;
  }

  const recommendations = ((getDatabase()
    .prepare(
      `
      SELECT
        r.*,
        p.sku,
        p.title,
        p.inventory_quantity,
        p.last_synced_at,
        COALESCE(latest_update.status, 'not_updated') AS shopify_update_status,
        latest_update.error AS shopify_update_error,
        latest_update.updated_at AS shopify_update_at
      FROM price_recommendations r
      JOIN products p ON p.id = r.product_id
      LEFT JOIN (
        SELECT su.*
        FROM shopify_updates su
        JOIN (
          SELECT recommendation_id, MAX(id) AS id
          FROM shopify_updates
          GROUP BY recommendation_id
        ) latest ON latest.id = su.id
      ) latest_update ON latest_update.recommendation_id = r.id
      WHERE r.run_id = ?
      ORDER BY p.title ASC, p.id ASC
      `
    )
    .all(runId) as unknown) as RecommendationRow[]).map(hydrateRecommendationVatFields);

  const snapshots = getDatabase()
    .prepare(
      `
      SELECT *
      FROM price_snapshots
      WHERE run_id = ?
      ORDER BY fetched_at ASC, id ASC
      `
    )
    .all(runId) as StoredSnapshot[];

  const shopifyUpdates = getShopifyUpdatesForRun(runId);

  return {
    run,
    recommendations,
    snapshots,
    errors: snapshots.filter((snapshot) => snapshot.status === "failed"),
    shopifyUpdates
  };
}

export function setRecommendationApproval(recommendationId: number, approved: boolean): RecommendationRow {
  const recommendation = getRecommendation(recommendationId);
  if (!recommendation) {
    throw new Error("Rekommendationen hittades inte.");
  }

  if (approved && recommendation.status !== "OK") {
    throw new Error("Endast OK-rader kan godkännas.");
  }

  getDatabase()
    .prepare("UPDATE price_recommendations SET approved = ? WHERE id = ?")
    .run(approved ? 1 : 0, recommendationId);

  return getRecommendation(recommendationId) as RecommendationRow;
}

export function approveAllOk(runId: number): { approved_count: number } {
  assertRunExists(runId);
  const result = getDatabase()
    .prepare("UPDATE price_recommendations SET approved = 1 WHERE run_id = ? AND status = 'OK'")
    .run(runId);
  return { approved_count: Number(result.changes) };
}

export function clearApprovals(runId: number): { cleared_count: number } {
  assertRunExists(runId);
  const result = getDatabase().prepare("UPDATE price_recommendations SET approved = 0 WHERE run_id = ?").run(runId);
  return { cleared_count: Number(result.changes) };
}

export async function applyApprovedRecommendations(runId: number): Promise<{
  total: number;
  success_count: number;
  error_count: number;
  results: ApplyApprovedResult[];
}> {
  assertRunExists(runId);
  const candidates = loadApprovedUpdateCandidates(runId);
  const results: ApplyApprovedResult[] = [];
  const updateRequests: ShopifyUpdateRequest[] = [];
  const updateRequestRecommendations: RecommendationForUpdate[] = [];

  for (const recommendation of candidates) {
    const alreadyUpdated = hasSuccessfulShopifyUpdate(recommendation.id);
    if (alreadyUpdated) {
      const result = {
        recommendation_id: recommendation.id,
        product_id: recommendation.product_id,
        shopify_variant_id: recommendation.shopify_variant_id,
        old_price: recommendation.shopify_price_before,
        new_price: recommendation.suggested_price,
        status: "skipped_already_updated" as const,
        error: null
      };
      insertShopifyUpdateLog(result);
      results.push(result);
      continue;
    }

    if (
      recommendation.status !== "OK" ||
      recommendation.approved !== 1 ||
      recommendation.suggested_price === null ||
      !recommendation.shopify_variant_id ||
      recommendation.shopify_price_before === null
    ) {
      const result = {
        recommendation_id: recommendation.id,
        product_id: recommendation.product_id,
        shopify_variant_id: recommendation.shopify_variant_id || null,
        old_price: recommendation.shopify_price_before,
        new_price: recommendation.suggested_price,
        status: "failed" as const,
        error: "Raden uppfyller inte kraven för Shopify-uppdatering."
      };
      insertShopifyUpdateLog(result);
      results.push(result);
      continue;
    }

    updateRequests.push({
      sku: recommendation.sku || String(recommendation.product_id),
      productId: recommendation.shopify_product_id,
      variantId: recommendation.shopify_variant_id,
      oldPrice: recommendation.shopify_price_before,
      newPrice: recommendation.suggested_price
    });
    updateRequestRecommendations.push(recommendation);
  }

  const shopifyResults = await updateShopifyPrices(updateRequests);
  for (let index = 0; index < shopifyResults.length; index += 1) {
    const shopifyResult = shopifyResults[index];
    const recommendation = updateRequestRecommendations[index];
    const result = {
      recommendation_id: recommendation.id,
      product_id: recommendation.product_id,
      shopify_variant_id: recommendation.shopify_variant_id,
      old_price: recommendation.shopify_price_before,
      new_price: recommendation.suggested_price,
      status: shopifyResult.status === "updated" ? ("success" as const) : ("failed" as const),
      error: shopifyResult.error ?? null
    };
    insertShopifyUpdateLog(result);
    results.push(result);
  }

  return {
    total: results.length,
    success_count: results.filter((result) => result.status === "success").length,
    error_count: results.filter((result) => result.status === "failed").length,
    results
  };
}

export function getShopifyUpdatesForRun(runId: number): ShopifyUpdateLogRow[] {
  assertRunExists(runId);
  return (getDatabase()
    .prepare(
      `
      SELECT
        su.*,
        p.sku,
        p.title
      FROM shopify_updates su
      JOIN price_recommendations r ON r.id = su.recommendation_id
      JOIN products p ON p.id = su.product_id
      WHERE r.run_id = ?
      ORDER BY su.updated_at DESC, su.id DESC
      `
    )
    .all(runId) as unknown) as ShopifyUpdateLogRow[];
}

function hydrateRecommendationVatFields(row: RecommendationRow): RecommendationRow {
  const vatPercent = row.vat_percent ?? 25;
  const costPriceVatMode = normalizeRuleVatMode(row.cost_price_vat_mode, "ex_vat");
  const salesPriceVatMode = normalizeRuleVatMode(row.sales_price_vat_mode, "inc_vat");
  const shopifyPriceVatMode = normalizeRuleVatMode(row.shopify_price_vat_mode, salesPriceVatMode);
  const costPriceIncVat =
    row.cost_price_inc_vat ?? (row.cost_price === null ? null : toIncVat(row.cost_price, vatPercent, costPriceVatMode));
  const costPriceExVat =
    row.cost_price_ex_vat ?? (row.cost_price === null ? null : toExVat(row.cost_price, vatPercent, costPriceVatMode));
  const shopifyPriceIncVat =
    row.shopify_price_inc_vat ??
    (row.shopify_price_before === null ? null : toIncVat(row.shopify_price_before, vatPercent, shopifyPriceVatMode));
  const shopifyPriceExVat =
    row.shopify_price_ex_vat ??
    (row.shopify_price_before === null ? null : toExVat(row.shopify_price_before, vatPercent, shopifyPriceVatMode));
  const competitorPriceIncVat =
    row.cheapest_competitor_price_inc_vat ??
    (row.cheapest_competitor_price === null
      ? null
      : toIncVat(row.cheapest_competitor_price, vatPercent, salesPriceVatMode));
  const competitorPriceExVat =
    row.cheapest_competitor_price_ex_vat ??
    (row.cheapest_competitor_price === null
      ? null
      : toExVat(row.cheapest_competitor_price, vatPercent, salesPriceVatMode));
  const suggestedPriceIncVat =
    row.suggested_price_inc_vat ??
    (row.suggested_price === null ? null : toIncVat(row.suggested_price, vatPercent, salesPriceVatMode));
  const suggestedPriceExVat =
    row.suggested_price_ex_vat ??
    (row.suggested_price === null ? null : toExVat(row.suggested_price, vatPercent, salesPriceVatMode));
  const minAllowed =
    row.cost_price !== null && row.min_margin_percent !== null
      ? calculateMinAllowedPrice({
          costPrice: row.cost_price,
          costPriceVatMode,
          salesPriceVatMode,
          vatPercent,
          minMarginPercent: row.min_margin_percent
        })
      : null;
  const tb1 =
    row.suggested_price !== null && row.cost_price !== null
      ? calculateTb1({
          sellingPrice: row.suggested_price,
          salesPriceVatMode,
          costPrice: row.cost_price,
          costPriceVatMode,
          vatPercent
        })
      : null;

  return {
    ...row,
    cost_price_vat_mode: costPriceVatMode,
    sales_price_vat_mode: salesPriceVatMode,
    shopify_price_vat_mode: shopifyPriceVatMode,
    vat_percent: vatPercent,
    cost_price_inc_vat: costPriceIncVat,
    cost_price_ex_vat: costPriceExVat,
    shopify_price_inc_vat: shopifyPriceIncVat,
    shopify_price_ex_vat: shopifyPriceExVat,
    cheapest_competitor_price_inc_vat: competitorPriceIncVat,
    cheapest_competitor_price_ex_vat: competitorPriceExVat,
    suggested_price_inc_vat: suggestedPriceIncVat,
    suggested_price_ex_vat: suggestedPriceExVat,
    min_allowed_price: row.min_allowed_price ?? minAllowed?.minAllowedPrice ?? null,
    min_allowed_price_inc_vat: row.min_allowed_price_inc_vat ?? minAllowed?.minAllowedPriceIncVat ?? null,
    min_allowed_price_ex_vat: row.min_allowed_price_ex_vat ?? minAllowed?.minAllowedPriceExVat ?? null,
    tb1_amount: row.tb1_amount ?? tb1?.tb1Amount ?? null,
    tb1_percent: row.tb1_percent ?? tb1?.tb1Percent ?? null,
    margin_after_percent: row.margin_after_percent ?? tb1?.tb1Percent ?? null
  };
}

function createRun(startedAt: string): number {
  const result = getDatabase()
    .prepare(
      `
      INSERT INTO price_runs (started_at, status, created_at)
      VALUES (?, 'running', ?)
      `
    )
    .run(startedAt, startedAt);
  return Number(result.lastInsertRowid);
}

function getRecommendation(recommendationId: number): RecommendationRow | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT
        r.*,
        p.sku,
        p.title,
        p.inventory_quantity,
        p.last_synced_at
      FROM price_recommendations r
      JOIN products p ON p.id = r.product_id
      WHERE r.id = ?
      `
    )
    .get(recommendationId) as RecommendationRow | undefined;

  return row ?? null;
}

function assertRunExists(runId: number): void {
  const run = getDatabase().prepare("SELECT id FROM price_runs WHERE id = ?").get(runId);
  if (!run) {
    throw new Error("Körningen hittades inte.");
  }
}

function loadApprovedUpdateCandidates(runId: number): RecommendationForUpdate[] {
  return (getDatabase()
    .prepare(
      `
      SELECT
        r.*,
        p.sku,
        p.title,
        p.inventory_quantity,
        p.last_synced_at,
        p.shopify_product_id,
        p.shopify_variant_id
      FROM price_recommendations r
      JOIN products p ON p.id = r.product_id
      WHERE r.run_id = ? AND r.approved = 1 AND r.status = 'OK'
      ORDER BY r.id ASC
      `
    )
    .all(runId) as unknown) as RecommendationForUpdate[];
}

function hasSuccessfulShopifyUpdate(recommendationId: number): boolean {
  const row = getDatabase()
    .prepare("SELECT id FROM shopify_updates WHERE recommendation_id = ? AND status = 'success' LIMIT 1")
    .get(recommendationId);
  return Boolean(row);
}

function insertShopifyUpdateLog(result: ApplyApprovedResult): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO shopify_updates (
        recommendation_id,
        product_id,
        shopify_variant_id,
        old_price,
        new_price,
        status,
        error,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      result.recommendation_id,
      result.product_id,
      result.shopify_variant_id ?? "",
      result.old_price ?? 0,
      result.new_price ?? 0,
      result.status,
      result.error,
      new Date().toISOString()
    );
}

function hasRunningPriceRun(): boolean {
  const row = getDatabase().prepare("SELECT id FROM price_runs WHERE status = 'running' LIMIT 1").get();
  return Boolean(row);
}

function loadRunProducts(scopeType: PriceRunScopeType | "all"): RunProduct[] {
  const products = getDatabase()
    .prepare(
      `
      SELECT
        id,
        shopify_product_id,
        shopify_variant_id,
        sku,
        title,
        vendor,
        product_type,
        barcode,
        inventory_quantity,
        active
      FROM products
      ORDER BY id ASC
      `
    )
    .all() as RunProductRow[];

  const ruleStatement = getDatabase().prepare("SELECT * FROM pricing_rules WHERE product_id = ?");
  const linksStatement = getDatabase().prepare("SELECT * FROM competitor_links WHERE product_id = ? AND enabled = 1");

  return products
    .map((product) => ({
      product,
      pricingRule: (ruleStatement.get(product.id) as PricingRuleRow | undefined) ?? null,
      competitorLinks: linksStatement.all(product.id) as unknown as CompetitorLinkRow[]
    }))
    .filter((item) => productMatchesScope(item, scopeType));
}

function productMatchesScope(item: RunProduct, scopeType: PriceRunScopeType | "all"): boolean {
  if (scopeType === "all") {
    return true;
  }

  if (item.product.active !== 1) {
    return false;
  }

  if (scopeType === "all_active") {
    return true;
  }

  if (item.product.inventory_quantity <= 0) {
    return false;
  }

  if (scopeType === "in_stock") {
    return true;
  }

  return Boolean(
    item.pricingRule &&
      item.pricingRule.enabled === 1 &&
      item.pricingRule.cost_price !== null &&
      item.pricingRule.min_margin_percent !== null &&
      item.competitorLinks.length > 0
  );
}

function updateProductsFromShopifyStates(
  products: RunProduct[],
  states: Map<string, ShopifyVariantState>
): { updatedCount: number } {
  const statement = getDatabase().prepare(
    `
    UPDATE products
    SET
      shopify_product_id = ?,
      sku = ?,
      title = ?,
      vendor = ?,
      product_type = ?,
      barcode = ?,
      shopify_price = ?,
      inventory_quantity = ?,
      active = ?,
      last_synced_at = ?,
      updated_at = ?
    WHERE id = ?
    `
  );
  const now = new Date().toISOString();
  let updatedCount = 0;

  for (const item of products) {
    const state = states.get(item.product.shopify_variant_id);
    if (!state) {
      continue;
    }
    const active = state.active ? 1 : 0;
    statement.run(
      state.productId,
      state.sku,
      state.title,
      state.vendor,
      state.productType,
      state.barcode,
      state.price,
      state.inventoryQuantity,
      active,
      now,
      now,
      item.product.id
    );
    item.product.shopify_product_id = state.productId;
    item.product.sku = state.sku;
    item.product.title = state.title;
    item.product.vendor = state.vendor;
    item.product.product_type = state.productType;
    item.product.barcode = state.barcode;
    item.product.inventory_quantity = state.inventoryQuantity;
    item.product.active = active;
    updatedCount += 1;
  }

  return { updatedCount };
}

function insertSnapshot(runId: number, job: PriceJob, scraped: ScrapedPriceResult): StoredSnapshot {
  const result = getDatabase()
    .prepare(
      `
      INSERT INTO price_snapshots (
        run_id,
        product_id,
        competitor_link_id,
        url,
        domain,
        price,
        status,
        error,
        fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      runId,
      job.product.id,
      job.link.id,
      job.link.url,
      job.link.domain,
      scraped.price,
      scraped.status,
      scraped.error ?? null,
      scraped.fetchedAt
    );

  return {
    id: Number(result.lastInsertRowid),
    run_id: runId,
    product_id: job.product.id,
    competitor_link_id: job.link.id,
    url: job.link.url,
    domain: job.link.domain,
    price: scraped.price,
    status: scraped.status,
    error: scraped.error ?? null,
    fetched_at: scraped.fetchedAt
  };
}

function updateCompetitorLinkAfterScrape(linkId: number, snapshot: StoredSnapshot): void {
  getDatabase()
    .prepare(
      `
      UPDATE competitor_links
      SET last_checked_at = ?, last_price = ?, last_status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
      `
    )
    .run(snapshot.fetched_at, snapshot.price, snapshot.status, snapshot.error, snapshot.fetched_at, linkId);
}

function buildRecommendation(
  input: RecommendationInput
): Omit<RecommendationRow, "id" | "sku" | "title" | "inventory_quantity" | "last_synced_at"> {
  const { runId, product, pricingRule, shopifyState, shopifyError, snapshots, createdAt } = input;
  const costPrice = pricingRule?.cost_price ?? null;
  const costPriceVatMode = normalizeRuleVatMode(pricingRule?.cost_price_vat_mode, "ex_vat");
  const salesPriceVatMode = normalizeRuleVatMode(pricingRule?.sales_price_vat_mode, "inc_vat");
  const vatPercent = pricingRule?.vat_percent ?? 25;
  const minMarginPercent = pricingRule?.min_margin_percent ?? null;
  const undercutAmount = pricingRule?.undercut_amount ?? 0;
  const shopifyPrice = shopifyState?.price ?? null;
  const shopifyPriceIncVat =
    shopifyPrice === null ? null : toIncVat(shopifyPrice, vatPercent, salesPriceVatMode);
  const shopifyPriceExVat =
    shopifyPrice === null ? null : toExVat(shopifyPrice, vatPercent, salesPriceVatMode);
  const costPriceIncVat = costPrice === null ? null : toIncVat(costPrice, vatPercent, costPriceVatMode);
  const costPriceExVat = costPrice === null ? null : toExVat(costPrice, vatPercent, costPriceVatMode);
  const minAllowed =
    costPrice !== null && minMarginPercent !== null
      ? calculateMinAllowedPrice({
          costPrice,
          costPriceVatMode,
          salesPriceVatMode,
          vatPercent,
          minMarginPercent
        })
      : null;

  const base = {
    run_id: runId,
    product_id: product.id,
    shopify_price_before: shopifyPrice,
    shopify_price_inc_vat: shopifyPriceIncVat,
    shopify_price_ex_vat: shopifyPriceExVat,
    shopify_price_vat_mode: salesPriceVatMode,
    cheapest_competitor_domain: null,
    cheapest_competitor_url: null,
    cheapest_competitor_price: null,
    cheapest_competitor_price_inc_vat: null,
    cheapest_competitor_price_ex_vat: null,
    suggested_price: null,
    suggested_price_inc_vat: null,
    suggested_price_ex_vat: null,
    cost_price: costPrice,
    cost_price_inc_vat: costPriceIncVat,
    cost_price_ex_vat: costPriceExVat,
    cost_price_vat_mode: costPriceVatMode,
    sales_price_vat_mode: salesPriceVatMode,
    vat_percent: vatPercent,
    min_margin_percent: minMarginPercent,
    min_allowed_price: minAllowed?.minAllowedPrice ?? null,
    min_allowed_price_inc_vat: minAllowed?.minAllowedPriceIncVat ?? null,
    min_allowed_price_ex_vat: minAllowed?.minAllowedPriceExVat ?? null,
    tb1_amount: null,
    tb1_percent: null,
    margin_after_percent: null,
    approved: 0,
    created_at: createdAt
  };

  if (product.active !== 1 || (pricingRule && pricingRule.enabled !== 1)) {
    return {
      ...base,
      status: "SKIPPAD_INAKTIV",
      reason: "Produkten eller prismatchningsregeln är inaktiv."
    };
  }

  if (shopifyError || !shopifyState) {
    return {
      ...base,
      status: "SHOPIFY_FEL",
      reason: shopifyError ?? "Kunde inte hämta produkten från Shopify."
    };
  }

  if (shopifyState.inventoryQuantity <= 0) {
    return {
      ...base,
      status: "SKIPPAD_EGET_LAGER_0",
      reason: "Produkten finns inte i lager i din Shopify-butik. Konkurrentlänkar hämtades inte."
    };
  }

  if (!pricingRule || costPrice === null) {
    return {
      ...base,
      status: "SAKNAR_INKOPSPRIS",
      reason: pricingRule ? "Inköpspris saknas. Kan inte räkna TB1." : "Prismatchningsregel saknas."
    };
  }

  if (minMarginPercent === null) {
    return {
      ...base,
      status: "SAKNAR_MIN_MARGINAL",
      reason: "Min TB1 % saknas. Kan inte räkna lägsta tillåtna pris."
    };
  }

  if (snapshots.length === 0) {
    return {
      ...base,
      status: "SAKNAR_LANKAR",
      reason: "Produkten saknar aktiva konkurrentlänkar."
    };
  }

  const validSnapshots = snapshots.filter(
    (snapshot) => snapshot.status === "success" && typeof snapshot.price === "number" && snapshot.price > 0
  );

  if (validSnapshots.length === 0) {
    return {
      ...base,
      status: "INGET_PRIS",
      reason: "Inget giltigt konkurrentpris kunde hämtas."
    };
  }

  const candidates = validSnapshots.map((snapshot) => {
    const competitorPrice = snapshot.price as number;
    const suggestedPrice = roundMoney(competitorPrice - undercutAmount);
    return {
      snapshot,
      competitorPrice,
      suggestedPrice,
      sellingPriceExVat: toExVat(suggestedPrice, vatPercent, salesPriceVatMode)
    };
  });

  const cheapestOverall = candidates.reduce((lowest, current) =>
    current.competitorPrice < lowest.competitorPrice ? current : lowest
  );

  const eligibleCandidates = candidates.filter(
    (candidate) => minAllowed !== null && candidate.sellingPriceExVat >= minAllowed.minAllowedPriceExVat
  );

  const lowestBlockedCount = candidates.length - eligibleCandidates.length;

  if (eligibleCandidates.length === 0 || minAllowed === null) {
    const priced = buildPricedRecommendationValues({
      base,
      snapshot: cheapestOverall.snapshot,
      competitorPrice: cheapestOverall.competitorPrice,
      suggestedPrice: cheapestOverall.suggestedPrice,
      costPrice,
      costPriceVatMode,
      salesPriceVatMode,
      vatPercent,
      minAllowed
    });

    return {
      ...priced,
      status: "BLOCKERAD_MARGINAL",
      reason: "Alla giltiga konkurrentpriser skulle ge ett föreslaget pris under minsta tillåtna TB1."
    };
  }

  const cheapest = eligibleCandidates.reduce((lowest, current) =>
    current.suggestedPrice < lowest.suggestedPrice ? current : lowest
  );
  const priced = buildPricedRecommendationValues({
    base,
    snapshot: cheapest.snapshot,
    competitorPrice: cheapest.competitorPrice,
    suggestedPrice: cheapest.suggestedPrice,
    costPrice,
    costPriceVatMode,
    salesPriceVatMode,
    vatPercent,
    minAllowed
  });

  if (roundMoney(shopifyState.price) === cheapest.suggestedPrice) {
    return {
      ...priced,
      status: "INGEN_ANDRING",
      reason: "Shopify-priset ligger redan på föreslaget pris."
    };
  }

  const ignoredPriceNote =
    lowestBlockedCount > 0
      ? ` ${lowestBlockedCount} lägre konkurrentpris ignorerades eftersom de skulle gå under minsta TB1.`
      : "";

  return {
    ...priced,
    status: "OK",
    reason: `Billigaste konkurrent som klarar TB1-regeln är ${cheapest.snapshot.domain} med ${cheapest.competitorPrice} kr. Föreslaget pris är ${cheapest.suggestedPrice} kr.${ignoredPriceNote}`
  };
}

function buildPricedRecommendationValues(params: {
  base: Omit<
    RecommendationRow,
    | "id"
    | "sku"
    | "title"
    | "inventory_quantity"
    | "last_synced_at"
    | "status"
    | "reason"
  >;
  snapshot: StoredSnapshot;
  competitorPrice: number;
  suggestedPrice: number;
  costPrice: number;
  costPriceVatMode: VatMode;
  salesPriceVatMode: VatMode;
  vatPercent: number;
  minAllowed: ReturnType<typeof calculateMinAllowedPrice> | null;
}): Omit<RecommendationRow, "id" | "sku" | "title" | "inventory_quantity" | "last_synced_at" | "status" | "reason"> {
  const tb1 = calculateTb1({
    sellingPrice: params.suggestedPrice,
    salesPriceVatMode: params.salesPriceVatMode,
    costPrice: params.costPrice,
    costPriceVatMode: params.costPriceVatMode,
    vatPercent: params.vatPercent
  });

  return {
    ...params.base,
    cheapest_competitor_domain: params.snapshot.domain,
    cheapest_competitor_url: params.snapshot.url,
    cheapest_competitor_price: params.competitorPrice,
    cheapest_competitor_price_inc_vat: toIncVat(
      params.competitorPrice,
      params.vatPercent,
      params.salesPriceVatMode
    ),
    cheapest_competitor_price_ex_vat: toExVat(
      params.competitorPrice,
      params.vatPercent,
      params.salesPriceVatMode
    ),
    suggested_price: params.suggestedPrice,
    suggested_price_inc_vat: tb1.sellingPriceIncVat,
    suggested_price_ex_vat: tb1.sellingPriceExVat,
    cost_price_inc_vat: tb1.costPriceIncVat,
    cost_price_ex_vat: tb1.costPriceExVat,
    min_allowed_price: params.minAllowed?.minAllowedPrice ?? null,
    min_allowed_price_inc_vat: params.minAllowed?.minAllowedPriceIncVat ?? null,
    min_allowed_price_ex_vat: params.minAllowed?.minAllowedPriceExVat ?? null,
    tb1_amount: tb1.tb1Amount,
    tb1_percent: tb1.tb1Percent,
    margin_after_percent: tb1.tb1Percent
  };
}

function normalizeRuleVatMode(value: VatMode | null | undefined, fallback: VatMode): VatMode {
  return value === "ex_vat" || value === "inc_vat" ? value : fallback;
}

function insertRecommendation(
  recommendation: Omit<RecommendationRow, "id" | "sku" | "title" | "inventory_quantity" | "last_synced_at">
): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO price_recommendations (
        run_id,
        product_id,
        shopify_price_before,
        shopify_price_inc_vat,
        shopify_price_ex_vat,
        shopify_price_vat_mode,
        cheapest_competitor_domain,
        cheapest_competitor_url,
        cheapest_competitor_price,
        cheapest_competitor_price_inc_vat,
        cheapest_competitor_price_ex_vat,
        suggested_price,
        suggested_price_inc_vat,
        suggested_price_ex_vat,
        cost_price,
        cost_price_inc_vat,
        cost_price_ex_vat,
        cost_price_vat_mode,
        sales_price_vat_mode,
        vat_percent,
        min_margin_percent,
        min_allowed_price,
        min_allowed_price_inc_vat,
        min_allowed_price_ex_vat,
        tb1_amount,
        tb1_percent,
        margin_after_percent,
        status,
        reason,
        approved,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      recommendation.run_id,
      recommendation.product_id,
      recommendation.shopify_price_before,
      recommendation.shopify_price_inc_vat,
      recommendation.shopify_price_ex_vat,
      recommendation.shopify_price_vat_mode,
      recommendation.cheapest_competitor_domain,
      recommendation.cheapest_competitor_url,
      recommendation.cheapest_competitor_price,
      recommendation.cheapest_competitor_price_inc_vat,
      recommendation.cheapest_competitor_price_ex_vat,
      recommendation.suggested_price,
      recommendation.suggested_price_inc_vat,
      recommendation.suggested_price_ex_vat,
      recommendation.cost_price,
      recommendation.cost_price_inc_vat,
      recommendation.cost_price_ex_vat,
      recommendation.cost_price_vat_mode,
      recommendation.sales_price_vat_mode,
      recommendation.vat_percent,
      recommendation.min_margin_percent,
      recommendation.min_allowed_price,
      recommendation.min_allowed_price_inc_vat,
      recommendation.min_allowed_price_ex_vat,
      recommendation.tb1_amount,
      recommendation.tb1_percent,
      recommendation.margin_after_percent,
      recommendation.status,
      recommendation.reason,
      recommendation.approved,
      recommendation.created_at
    );
}

function completeRun(runId: number, status: "completed" | "failed"): void {
  const stats = getDatabase()
    .prepare(
      `
      SELECT
        COUNT(*) AS total_links_checked,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success_count,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS error_count
      FROM price_snapshots
      WHERE run_id = ?
      `
    )
    .get(runId) as { total_links_checked: number; success_count: number; error_count: number };

  const skippedStock = getDatabase()
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM price_recommendations
      WHERE run_id = ? AND status = 'SKIPPAD_EGET_LAGER_0'
      `
    )
    .get(runId) as { count: number };

  const shopifyErrors = getDatabase()
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM price_recommendations
      WHERE run_id = ? AND status = 'SHOPIFY_FEL'
      `
    )
    .get(runId) as { count: number };

  getDatabase()
    .prepare(
      `
      UPDATE price_runs
      SET
        finished_at = ?,
        status = ?,
        products_skipped_no_stock = ?,
        total_links_checked = ?,
        success_count = ?,
        error_count = ?
      WHERE id = ?
      `
    )
    .run(
      new Date().toISOString(),
      status,
      skippedStock.count,
      stats.total_links_checked,
      stats.success_count,
      stats.error_count + shopifyErrors.count,
      runId
    );
}

function updateRunTotals(runId: number, totals: { total_products: number }): void {
  getDatabase().prepare("UPDATE price_runs SET total_products = ? WHERE id = ?").run(totals.total_products, runId);
}

function getPriceRunRow(runId: number): PriceRunRow {
  return getDatabase().prepare("SELECT * FROM price_runs WHERE id = ?").get(runId) as PriceRunRow;
}
