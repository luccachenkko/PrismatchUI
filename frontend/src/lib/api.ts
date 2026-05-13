import type {
  CompetitorLink,
  DashboardStats,
  PriceRun,
  PricingRule,
  Product,
  ProductDetail,
  RunReport,
  Schedule,
  SchedulePayload,
  ShopifyUpdate,
} from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers,
    },
  });

  const payload = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const error = [payload["error"], payload["details"]].filter(Boolean).join(" ");
    throw new Error(error || `HTTP ${response.status}`);
  }

  return payload as T;
}

export const api = {
  health: () => request("/api/health"),
  products: () => request<{ products: Product[]; stats: DashboardStats }>("/api/products"),
  product: (id: number) => request<ProductDetail>(`/api/products/${id}`),
  syncShopify: () => request<{ syncedCount: number }>("/api/shopify/sync-products", { method: "POST" }),
  savePricingRule: (
    productId: number,
    rule: {
      cost_price: number | null;
      cost_price_vat_mode: "ex_vat" | "inc_vat";
      sales_price_vat_mode: "ex_vat" | "inc_vat";
      vat_percent: number;
      min_margin_percent: number | null;
      undercut_amount: number | null;
      enabled: boolean;
    }
  ) => request<{ pricingRule: PricingRule }>(`/api/products/${productId}/pricing-rule`, {
    method: "PUT",
    body: JSON.stringify(rule),
  }),
  createLink: (productId: number, data: { url: string; enabled: boolean }) =>
    request<{ competitorLink: CompetitorLink }>(`/api/products/${productId}/competitor-links`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateLink: (linkId: number, data: { url: string; enabled: boolean }) =>
    request<{ competitorLink: CompetitorLink }>(`/api/competitor-links/${linkId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteLink: (linkId: number) => request<void>(`/api/competitor-links/${linkId}`, { method: "DELETE" }),
  startRun: () => request<{ run: PriceRun }>("/api/price-runs", { method: "POST" }),
  runs: () => request<{ runs: PriceRun[] }>("/api/price-runs"),
  run: (id: number) => request<RunReport>(`/api/price-runs/${id}`),
  setApproval: (recommendationId: number, approved: boolean) =>
    request<{ recommendation: { id: number; approved: number } }>(
      `/api/price-recommendations/${recommendationId}/approval`,
      { method: "PATCH", body: JSON.stringify({ approved }) }
    ),
  approveAllOk: (runId: number) =>
    request<{ approved_count: number }>(`/api/price-runs/${runId}/approve-all-ok`, { method: "POST" }),
  clearApprovals: (runId: number) =>
    request<{ cleared_count: number }>(`/api/price-runs/${runId}/clear-approvals`, { method: "POST" }),
  applyApproved: (runId: number) =>
    request<{ total: number; success_count: number; error_count: number }>(
      `/api/price-runs/${runId}/apply-approved`,
      { method: "POST" }
    ),
  shopifyUpdates: (runId: number) =>
    request<{ updates: ShopifyUpdate[] }>(`/api/price-runs/${runId}/shopify-updates`),
  schedules: () => request<{ schedules: Schedule[] }>("/api/schedules"),
  createSchedule: (data: SchedulePayload) =>
    request<{ schedule: Schedule }>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSchedule: (scheduleId: number, data: SchedulePayload) =>
    request<{ schedule: Schedule }>(`/api/schedules/${scheduleId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteSchedule: (scheduleId: number) =>
    request<{ ok: true }>(`/api/schedules/${scheduleId}`, { method: "DELETE" }),
  runScheduleNow: (scheduleId: number) =>
    request<{ schedule: Schedule; run: PriceRun | null }>(`/api/schedules/${scheduleId}/run-now`, {
      method: "POST",
    }),
};

export const STATUS_LABELS: Record<string, string> = {
  OK: "OK",
  INGEN_ANDRING: "Ingen ändring",
  SKIPPAD_EGET_LAGER_0: "Lager 0",
  SAKNAR_INKOPSPRIS: "Saknar inköpspris",
  SAKNAR_MIN_MARGINAL: "Saknar min TB1",
  SAKNAR_LANKAR: "Saknar länkar",
  INGET_PRIS: "Inget pris",
  BLOCKERAD_MARGINAL: "Blockerad TB1",
  SHOPIFY_FEL: "Shopify-fel",
  completed: "completed",
  running: "running",
  failed: "failed",
  success: "success",
  updated: "updated",
  not_updated: "not updated",
  skipped_already_updated: "redan uppdaterad",
};

export const STATUS_TONES: Record<string, "ok" | "warn" | "err" | "muted"> = {
  OK: "ok",
  completed: "ok",
  success: "ok",
  updated: "ok",
  INGEN_ANDRING: "muted",
  not_updated: "muted",
  skipped_already_updated: "muted",
  SKIPPAD_EGET_LAGER_0: "warn",
  SAKNAR_INKOPSPRIS: "warn",
  SAKNAR_MIN_MARGINAL: "warn",
  SAKNAR_LANKAR: "warn",
  INGET_PRIS: "warn",
  BLOCKERAD_MARGINAL: "warn",
  running: "warn",
  SHOPIFY_FEL: "err",
  failed: "err",
};

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
  }).format(value);
}

export function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value} %`;
}
