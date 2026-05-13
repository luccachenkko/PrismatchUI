import type {
  CompetitorLink,
  DashboardStats,
  PricingRule,
  Product,
  ProductDetail,
  PriceRun,
  RunReport,
  ShopifyUpdate,
} from "./types";

// Configure with VITE_API_BASE_URL (e.g. "http://localhost:3000"). Defaults to same origin.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(BASE + url, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    const error = [payload?.error, payload?.details].filter(Boolean).join(" ");
    throw new Error(error || `HTTP ${response.status}`);
  }
  return payload as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  products: () =>
    request<{ products: Product[]; stats: DashboardStats }>("/api/products"),
  product: (id: number) => request<ProductDetail>(`/api/products/${id}`),
  syncShopify: () =>
    request<{ syncedCount: number }>("/api/shopify/sync-products", { method: "POST" }),
  startRun: () => request<{ run: PriceRun }>("/api/price-runs", { method: "POST" }),
  runs: () => request<{ runs: PriceRun[] }>("/api/price-runs"),
  run: (id: number) => request<RunReport>(`/api/price-runs/${id}`),
  approveAllOk: (id: number) =>
    request<{ approved_count: number }>(`/api/price-runs/${id}/approve-all-ok`, {
      method: "POST",
    }),
  clearApprovals: (id: number) =>
    request<{ cleared_count: number }>(`/api/price-runs/${id}/clear-approvals`, {
      method: "POST",
    }),
  applyApproved: (id: number) =>
    request<{ total: number; success_count: number; error_count: number }>(
      `/api/price-runs/${id}/apply-approved`,
      { method: "POST" }
    ),
  shopifyUpdates: (id: number) =>
    request<{ updates: ShopifyUpdate[] }>(`/api/price-runs/${id}/shopify-updates`),
  setApproval: (recommendationId: number, approved: boolean) =>
    request<{ recommendation: { id: number; approved: number } }>(
      `/api/price-recommendations/${recommendationId}/approval`,
      { method: "PATCH", body: JSON.stringify({ approved }) }
    ),
  savePricingRule: (
    productId: number,
    rule: {
      cost_price: number | null;
      min_margin_percent: number | null;
      undercut_amount: number | null;
      enabled: boolean;
    }
  ) =>
    request<{ pricingRule: PricingRule }>(`/api/products/${productId}/pricing-rule`, {
      method: "PUT",
      body: JSON.stringify(rule),
    }),
  createLink: (productId: number, data: { url: string; enabled: boolean }) =>
    request<{ competitorLink: CompetitorLink }>(
      `/api/products/${productId}/competitor-links`,
      { method: "POST", body: JSON.stringify(data) }
    ),
  updateLink: (linkId: number, data: { url: string; enabled: boolean }) =>
    request<{ competitorLink: CompetitorLink }>(`/api/competitor-links/${linkId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteLink: (linkId: number) =>
    request<void>(`/api/competitor-links/${linkId}`, { method: "DELETE" }),
};

export const STATUS_LABELS: Record<string, string> = {
  OK: "OK",
  INGEN_ANDRING: "Ingen ändring",
  SKIPPAD_EGET_LAGER_0: "Skippad — eget lager 0",
  SAKNAR_INKOPSPRIS: "Saknar inköpspris",
  SAKNAR_MIN_MARGINAL: "Saknar min marginal",
  SAKNAR_LANKAR: "Saknar länkar",
  INGET_PRIS: "Inget pris",
  BLOCKERAD_MARGINAL: "Blockerad — marginal",
  SHOPIFY_FEL: "Shopify-fel",
};

export const STATUS_TONES: Record<string, "ok" | "warn" | "err" | "muted"> = {
  OK: "ok",
  INGEN_ANDRING: "muted",
  SKIPPAD_EGET_LAGER_0: "muted",
  SAKNAR_INKOPSPRIS: "warn",
  SAKNAR_MIN_MARGINAL: "warn",
  SAKNAR_LANKAR: "warn",
  INGET_PRIS: "warn",
  BLOCKERAD_MARGINAL: "err",
  SHOPIFY_FEL: "err",
};

export const SUPPORTED_SCRAPERS = [
  "cdon.se",
  "hemmabutiken.se",
  "themobilestore.se",
  "conrad.se",
  "kulinagroup.se",
  "matlagning.com",
];

export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("sv-SE");
  } catch {
    return s;
  }
}
