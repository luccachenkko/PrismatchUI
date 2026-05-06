import { getEnvNumber } from "./env.js";
import { mapWithConcurrency } from "./concurrency.js";
import { getDatabase, type CompetitorLinkRow, type PricingRuleRow } from "./db.js";
import { roundMoney } from "./money.js";
import { scrapePriceForLink } from "./scrapers/index.js";
import { fetchShopifyVariantStatesByVariantIds, updateShopifyPrices } from "./shopify.js";
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
  shopify_price_before: number | null;
  cheapest_competitor_domain: string | null;
  cheapest_competitor_url: string | null;
  cheapest_competitor_price: number | null;
  suggested_price: number | null;
  cost_price: number | null;
  min_margin_percent: number | null;
  min_allowed_price: number | null;
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

let runningInProcess = false;

export async function startPriceRun(): Promise<PriceRunRow> {
  if (runningInProcess || hasRunningPriceRun()) {
    throw new Error("En prismatchningskörning pågår redan.");
  }

  runningInProcess = true;
  const startedAt = new Date().toISOString();
  const runId = createRun(startedAt);

  try {
    const runProducts = loadRunProducts();
    updateRunTotals(runId, { total_products: runProducts.length });

    const variantStates = await fetchShopifyVariantStatesByVariantIds(
      runProducts.map((item) => item.product.shopify_variant_id)
    );
    updateProductsFromShopifyStates(runProducts, variantStates);

    const eligibleProducts: RunProduct[] = [];
    for (const item of runProducts) {
      const state = variantStates.get(item.product.shopify_variant_id) ?? null;
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

  const recommendations = (getDatabase()
    .prepare(
      `
      SELECT
        r.*,
        p.sku,
        p.title,
        p.inventory_quantity,
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
    .all(runId) as unknown) as RecommendationRow[];

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
        p.inventory_quantity
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

function loadRunProducts(): RunProduct[] {
  const products = getDatabase()
    .prepare("SELECT id, shopify_product_id, shopify_variant_id, sku, title, active FROM products ORDER BY id ASC")
    .all() as RunProductRow[];

  const ruleStatement = getDatabase().prepare("SELECT * FROM pricing_rules WHERE product_id = ?");
  const linksStatement = getDatabase().prepare("SELECT * FROM competitor_links WHERE product_id = ? AND enabled = 1");

  return products.map((product) => ({
    product,
    pricingRule: (ruleStatement.get(product.id) as PricingRuleRow | undefined) ?? null,
    competitorLinks: linksStatement.all(product.id) as unknown as CompetitorLinkRow[]
  }));
}

function updateProductsFromShopifyStates(products: RunProduct[], states: Map<string, ShopifyVariantState>): void {
  const statement = getDatabase().prepare(
    `
    UPDATE products
    SET shopify_price = ?, inventory_quantity = ?, updated_at = ?
    WHERE id = ?
    `
  );
  const now = new Date().toISOString();

  for (const item of products) {
    const state = states.get(item.product.shopify_variant_id);
    if (!state) {
      continue;
    }
    statement.run(state.price, state.inventoryQuantity, now, item.product.id);
  }
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

function buildRecommendation(input: RecommendationInput): Omit<RecommendationRow, "id" | "sku" | "title" | "inventory_quantity"> {
  const { runId, product, pricingRule, shopifyState, shopifyError, snapshots, createdAt } = input;
  const costPrice = pricingRule?.cost_price ?? null;
  const minMarginPercent = pricingRule?.min_margin_percent ?? null;
  const undercutAmount = pricingRule?.undercut_amount ?? 0;
  const minAllowedPrice =
    costPrice !== null ? roundMoney(costPrice / (1 - (minMarginPercent ?? 0) / 100)) : null;

  const base = {
    run_id: runId,
    product_id: product.id,
    shopify_price_before: shopifyState?.price ?? null,
    cheapest_competitor_domain: null,
    cheapest_competitor_url: null,
    cheapest_competitor_price: null,
    suggested_price: null,
    cost_price: costPrice,
    min_margin_percent: minMarginPercent,
    min_allowed_price: minAllowedPrice,
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
      reason: pricingRule ? "Inköpspris saknas. Kan inte räkna marginal." : "Prismatchningsregel saknas."
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

  const cheapest = validSnapshots.reduce((lowest, current) =>
    current.price !== null && lowest.price !== null && current.price < lowest.price ? current : lowest
  );
  const cheapestPrice = cheapest.price as number;
  const suggestedPrice = roundMoney(cheapestPrice - undercutAmount);
  const marginAfter = roundMoney(((suggestedPrice - costPrice) / suggestedPrice) * 100);

  const priced = {
    ...base,
    cheapest_competitor_domain: cheapest.domain,
    cheapest_competitor_url: cheapest.url,
    cheapest_competitor_price: cheapestPrice,
    suggested_price: suggestedPrice,
    margin_after_percent: marginAfter
  };

  if (minAllowedPrice !== null && suggestedPrice < minAllowedPrice) {
    return {
      ...priced,
      status: "BLOCKERAD_MARGINAL",
      reason: "Föreslaget pris går under minsta tillåtna marginal."
    };
  }

  if (roundMoney(shopifyState.price) === suggestedPrice) {
    return {
      ...priced,
      status: "INGEN_ANDRING",
      reason: "Shopify-priset ligger redan på föreslaget pris."
    };
  }

  return {
    ...priced,
    status: "OK",
    reason: `Billigaste konkurrent är ${cheapest.domain} med ${cheapestPrice} kr. Föreslaget pris är ${suggestedPrice} kr.`
  };
}

function insertRecommendation(recommendation: Omit<RecommendationRow, "id" | "sku" | "title" | "inventory_quantity">): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO price_recommendations (
        run_id,
        product_id,
        shopify_price_before,
        cheapest_competitor_domain,
        cheapest_competitor_url,
        cheapest_competitor_price,
        suggested_price,
        cost_price,
        min_margin_percent,
        min_allowed_price,
        margin_after_percent,
        status,
        reason,
        approved,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      recommendation.run_id,
      recommendation.product_id,
      recommendation.shopify_price_before,
      recommendation.cheapest_competitor_domain,
      recommendation.cheapest_competitor_url,
      recommendation.cheapest_competitor_price,
      recommendation.suggested_price,
      recommendation.cost_price,
      recommendation.min_margin_percent,
      recommendation.min_allowed_price,
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
      stats.error_count,
      runId
    );
}

function updateRunTotals(runId: number, totals: { total_products: number }): void {
  getDatabase().prepare("UPDATE price_runs SET total_products = ? WHERE id = ?").run(totals.total_products, runId);
}

function getPriceRunRow(runId: number): PriceRunRow {
  return getDatabase().prepare("SELECT * FROM price_runs WHERE id = ?").get(runId) as PriceRunRow;
}
