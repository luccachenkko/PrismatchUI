export type VatMode = "ex_vat" | "inc_vat";

export type Product = {
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
  last_synced_at: string | null;
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

export type PricingRule = {
  id: number;
  product_id: number;
  cost_price: number | null;
  cost_price_vat_mode: VatMode;
  sales_price_vat_mode: VatMode;
  vat_percent: number;
  min_margin_percent: number | null;
  undercut_amount: number | null;
  enabled: number;
};

export type CompetitorLink = {
  id: number;
  product_id: number;
  url: string;
  domain: string;
  enabled: number;
  last_checked_at: string | null;
  last_price: number | null;
  last_status: string | null;
  last_error: string | null;
  scraper_supported: boolean;
};

export type ProductDetail = {
  product: Product;
  pricingRule: PricingRule | null;
  competitorLinks: CompetitorLink[];
};

export type PriceRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_products: number;
  products_skipped_no_stock: number;
  total_links_checked: number;
  success_count: number;
  error_count: number;
};

export type Recommendation = {
  id: number;
  run_id: number;
  product_id: number;
  sku: string | null;
  title: string;
  shopify_price_before: number | null;
  shopify_price_inc_vat: number | null;
  shopify_price_ex_vat: number | null;
  shopify_price_vat_mode: VatMode;
  inventory_quantity: number | null;
  last_synced_at: string | null;
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
  margin_after_percent: number | null;
  min_allowed_price: number | null;
  min_allowed_price_inc_vat: number | null;
  min_allowed_price_ex_vat: number | null;
  tb1_amount: number | null;
  tb1_percent: number | null;
  status: string;
  reason: string;
  approved: number;
  shopify_update_status: string | null;
};

export type PriceSnapshot = {
  id: number;
  run_id: number;
  product_id: number;
  competitor_link_id: number | null;
  url: string;
  domain: string;
  price: number | null;
  status: string;
  error: string | null;
  fetched_at: string;
};

export type ShopifyUpdate = {
  id: number;
  recommendation_id: number;
  product_id: number;
  shopify_variant_id: string;
  old_price: number | null;
  new_price: number | null;
  status: string;
  error: string | null;
  updated_at: string;
  sku: string | null;
  title: string | null;
};

export type RunReport = {
  run: PriceRun;
  recommendations: Recommendation[];
  snapshots: PriceSnapshot[];
  shopifyUpdates: ShopifyUpdate[];
};

export type ScheduleTaskType =
  | "shopify_sync_only"
  | "price_match_only"
  | "sync_and_price_match"
  | "top_products_price_match";

export type ScheduleScopeType = "all_active" | "in_stock" | "ready";

export type ScheduleFrequencyType = "daily" | "hourly" | "weekly";

export type Schedule = {
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

export type SchedulePayload = {
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
