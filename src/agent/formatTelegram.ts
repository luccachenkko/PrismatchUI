import type { CompetitorLink, PriceRun, ProductDetail, Recommendation, RunReport, VatMode } from "./telegramTypes.js";

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
    .format(value)
    .replace(/[\u00a0\u202f]/g, " ");
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${formatNumber(value)} %`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

export function formatProduct(detail: ProductDetail): string {
  const { product, pricingRule, competitorLinks } = detail;
  const activeLinks = competitorLinks.filter((link) => link.enabled === 1);
  const vatPercent = pricingRule?.vat_percent ?? null;
  const salesMode = pricingRule?.sales_price_vat_mode ?? null;
  const costMode = pricingRule?.cost_price_vat_mode ?? null;
  const shopifyPrice = formatVatPair(product.shopify_price, salesMode, vatPercent);
  const costPrice = formatVatPair(pricingRule?.cost_price ?? null, costMode, vatPercent);

  return [
    `Produkt ${product.sku ?? "-"}`,
    `Namn: ${product.title}`,
    `Shopify-pris: ${shopifyPrice}`,
    `Eget lager: ${product.inventory_quantity}`,
    `Inköpspris: ${costPrice}`,
    `Moms: ${formatPercent(vatPercent)}`,
    `Min TB1/marginal: ${formatPercent(pricingRule?.min_margin_percent)}`,
    `Konkurrentlänkar: ${activeLinks.length}`,
    `Status: ${productReadiness(detail)}`
  ].join("\n");
}

export function formatRules(detail: ProductDetail): string {
  const { product, pricingRule } = detail;
  if (!pricingRule) {
    return `Regler ${product.sku ?? "-"}\nRegel saknas.`;
  }

  return [
    `Regler ${product.sku ?? "-"}`,
    `Inköpspris: ${formatMoney(pricingRule.cost_price)}`,
    `Inköpspris momsbas: ${formatVatMode(pricingRule.cost_price_vat_mode)}`,
    `Försäljningspris momsbas: ${formatVatMode(pricingRule.sales_price_vat_mode)}`,
    `Moms: ${formatPercent(pricingRule.vat_percent)}`,
    `Min TB1/marginal: ${formatPercent(pricingRule.min_margin_percent)}`,
    `Undercut: ${formatMoney(pricingRule.undercut_amount)}`,
    `Regel: ${pricingRule.enabled === 1 ? "aktiv" : "inaktiv"}`
  ].join("\n");
}

export function formatLinks(detail: ProductDetail): string {
  const { product, competitorLinks } = detail;
  if (competitorLinks.length === 0) {
    return `Länkar ${product.sku ?? "-"}\nInga konkurrentlänkar finns sparade.`;
  }

  return [
    `Länkar ${product.sku ?? "-"}`,
    ...competitorLinks.map((link, index) => formatLink(index + 1, link))
  ].join("\n\n");
}

export function formatRunStarted(run: PriceRun, dryRun: boolean): string {
  return [
    `Prismatchning klar: run ${run.id}`,
    `Status: ${run.status}`,
    `Produkter: ${run.total_products}`,
    `Länkar kontrollerade: ${run.total_links_checked}`,
    `Lyckade hämtningar: ${run.success_count}`,
    `Fel: ${run.error_count}`,
    dryRun
      ? "Agent dry-run är på. Körningen skapar rapport/rekommendationer men Telegram uppdaterar inte Shopify."
      : "Telegram uppdaterar inte Shopify. Granska och godkänn rapporten i UI."
  ].join("\n");
}

export function formatReport(report: RunReport): string {
  const recommendations = report.recommendations ?? [];
  const shopifyUpdates = report.shopifyUpdates ?? [];
  const okCount = recommendations.filter((item) => item.status === "OK").length;
  const blockedCount = recommendations.filter((item) => item.status.startsWith("BLOCKERAD")).length;
  const pendingApprovalCount = recommendations.filter((item) => item.status === "OK" && item.approved !== 1).length;
  const updatedCount = shopifyUpdates.filter((item) => item.status === "success" || item.status === "updated").length;

  return [
    `Senaste rapport: run ${report.run.id}`,
    `Status: ${report.run.status}`,
    `Start: ${formatDate(report.run.started_at)}`,
    `Total produkter/rader: ${recommendations.length || report.run.total_products}`,
    `OK: ${okCount}`,
    `Blockerade: ${blockedCount}`,
    `Fel: ${report.run.error_count}`,
    `Uppdaterade Shopify: ${updatedCount}`,
    `Väntar på godkännande: ${pendingApprovalCount}`
  ].join("\n");
}

export function formatStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    OK: "OK",
    INGEN_ANDRING: "Ingen ändring",
    SKIPPAD_INAKTIV: "Inaktiv",
    SKIPPAD_EGET_LAGER_0: "Lager 0",
    SAKNAR_INKOPSPRIS: "Saknar inköpspris",
    SAKNAR_MIN_MARGINAL: "Saknar min TB1",
    SAKNAR_LANKAR: "Saknar länkar",
    INGET_PRIS: "Inget pris",
    BLOCKERAD_MARGINAL: "Blockerad marginal",
    SHOPIFY_FEL: "Shopify-fel"
  };

  return labels[status] ?? status;
}

function formatLink(index: number, link: CompetitorLink): string {
  const supported =
    typeof link.scraper_supported === "boolean" ? `Scraper: ${link.scraper_supported ? "stöds" : "saknas"}` : null;
  const lastPrice = link.last_price !== null ? `Senaste pris: ${formatMoney(link.last_price)}` : null;
  const lastStatus = link.last_status ? `Senaste status: ${link.last_status}` : null;

  return [
    `${index}. ${link.domain}`,
    `URL: ${link.url}`,
    `Aktiv: ${link.enabled === 1 ? "ja" : "nej"}`,
    supported,
    lastPrice,
    lastStatus
  ]
    .filter(Boolean)
    .join("\n");
}

function productReadiness(detail: ProductDetail): string {
  const { product, pricingRule, competitorLinks } = detail;
  const activeLinks = competitorLinks.filter((link) => link.enabled === 1);

  if (product.active !== 1) return "inaktiv";
  if (!pricingRule) return "saknar regel";
  if (pricingRule.enabled !== 1) return "regel inaktiv";
  if (pricingRule.cost_price === null) return "saknar inköpspris";
  if (pricingRule.min_margin_percent === null) return "saknar min TB1/marginal";
  if (activeLinks.length === 0) return "saknar länkar";
  if (product.inventory_quantity <= 0) return "lager 0";
  return "redo";
}

function formatVatPair(value: number | null, vatMode: VatMode | null, vatPercent: number | null): string {
  if (value === null) {
    return "-";
  }

  if (!vatMode || vatPercent === null) {
    return formatMoney(value);
  }

  return `${formatMoney(toIncVat(value, vatPercent, vatMode))} ink / ${formatMoney(
    toExVat(value, vatPercent, vatMode)
  )} ex`;
}

function formatVatMode(value: VatMode): string {
  return value === "inc_vat" ? "inkl moms" : "ex moms";
}

function toIncVat(value: number, vatPercent: number, mode: VatMode): number {
  return mode === "inc_vat" ? value : value * (1 + vatPercent / 100);
}

function toExVat(value: number, vatPercent: number, mode: VatMode): number {
  return mode === "ex_vat" ? value : value / (1 + vatPercent / 100);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("sv-SE", {
    maximumFractionDigits: 2
  }).format(value);
}
