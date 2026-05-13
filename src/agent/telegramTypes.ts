export type TelegramChat = {
  id: number;
  type: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramChat;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

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
  scraper_supported?: boolean;
};

export type ProductDetail = {
  product: Omit<
    Product,
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
  cheapest_competitor_domain: string | null;
  cheapest_competitor_url: string | null;
  cheapest_competitor_price: number | null;
  suggested_price: number | null;
  cost_price: number | null;
  cost_price_inc_vat: number | null;
  cost_price_ex_vat: number | null;
  cost_price_vat_mode: VatMode;
  sales_price_vat_mode: VatMode;
  vat_percent: number;
  min_margin_percent: number | null;
  min_allowed_price: number | null;
  margin_after_percent: number | null;
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
  errors?: PriceSnapshot[];
  shopifyUpdates: ShopifyUpdate[];
};
