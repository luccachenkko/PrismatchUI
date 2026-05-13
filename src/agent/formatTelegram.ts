import type {
  CompetitorLink,
  PriceRun,
  ProductDetail,
  Recommendation,
  RunReport,
  Schedule,
  SchedulePayload,
  VatMode
} from "./telegramTypes.js";

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


export function formatScheduleList(schedules: Schedule[]): string {
  if (schedules.length === 0) {
    return "Inga scheman finns sparade.";
  }

  const visible = schedules.slice(0, 12);
  const extraCount = schedules.length - visible.length;

  return [
    `Scheman: ${schedules.length}`,
    ...visible.map((schedule) =>
      [
        `#${schedule.id} ${schedule.name}`,
        `Status: ${schedule.enabled === 1 ? "aktiv" : "inaktiv"}`,
        `Gör: ${formatScheduleTask(schedule.task_type)}`,
        `Frekvens: ${formatScheduleFrequency(schedule)}`,
        `Nästa körning: ${formatDate(schedule.next_run_at)}`,
        schedule.last_error ? `Senaste fel: ${schedule.last_error}` : null
      ]
        .filter(Boolean)
        .join("\n")
    ),
    extraCount > 0 ? `Visar 12 av ${schedules.length}.` : null
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatScheduleDetail(schedule: Schedule): string {
  return [
    `Schema #${schedule.id}`,
    `Namn: ${schedule.name}`,
    `Status: ${schedule.enabled === 1 ? "aktiv" : "inaktiv"}`,
    `Gör: ${formatScheduleTask(schedule.task_type)}`,
    `Produkter: ${formatScheduleScope(schedule.scope_type)}`,
    `Frekvens: ${formatScheduleFrequency(schedule)}`,
    `Timezone: ${schedule.timezone}`,
    `Senast körd: ${formatDate(schedule.last_run_at)}`,
    `Nästa körning: ${formatDate(schedule.next_run_at)}`,
    `Senaste rapport: ${schedule.last_run_id ? `#${schedule.last_run_id}` : "-"}`,
    schedule.last_error ? `Senaste fel: ${schedule.last_error}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatScheduleCreated(schedule: Schedule): string {
  return [
    `Schema skapat: #${schedule.id}`,
    `Namn: ${schedule.name}`,
    `Gör: ${formatScheduleTask(schedule.task_type)}`,
    `Produkter: ${formatScheduleScope(schedule.scope_type)}`,
    `Frekvens: ${formatScheduleFrequency(schedule)}`,
    `Nästa körning: ${formatDate(schedule.next_run_at)}`,
    "Telegram-agenten skapar bara schema/rapporter. Den godkänner inte prisändringar och uppdaterar inte Shopify."
  ].join("\n");
}

export function formatScheduleUpdated(schedule: Schedule, action: string): string {
  return [
    `${action}: schema #${schedule.id}`,
    `Status: ${schedule.enabled === 1 ? "aktiv" : "inaktiv"}`,
    `Nästa körning: ${formatDate(schedule.next_run_at)}`
  ].join("\n");
}

export function formatScheduleDeleted(scheduleId: number): string {
  return `Schema #${scheduleId} togs bort.`;
}

export function formatScheduleRunResult(result: { schedule: Schedule; run: PriceRun | null }): string {
  return [
    `Schema #${result.schedule.id} kördes.`,
    result.run ? `Rapport skapad: run ${result.run.id}` : "Ingen prismatchningsrapport skapades för denna schematyp.",
    `Nästa körning: ${formatDate(result.schedule.next_run_at)}`,
    result.schedule.last_error ? `Fel: ${result.schedule.last_error}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export function describeSchedulePayload(payload: SchedulePayload): string {
  const scheduleLike: Schedule = {
    id: 0,
    name: payload.name,
    task_type: payload.task_type,
    scope_type: payload.scope_type,
    frequency_type: payload.frequency_type,
    time_of_day: payload.time_of_day,
    interval_hours: payload.interval_hours,
    weekday: payload.weekday,
    timezone: payload.timezone,
    enabled: payload.enabled ? 1 : 0,
    last_run_at: null,
    last_run_id: null,
    last_error: null,
    next_run_at: null,
    created_at: "",
    updated_at: ""
  };

  return [
    payload.name,
    formatScheduleTask(payload.task_type),
    formatScheduleScope(payload.scope_type),
    formatScheduleFrequency(scheduleLike)
  ].join(" · ");
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

function formatScheduleTask(taskType: string): string {
  if (taskType === "sync_and_price_match") return "Shopify-synk + prismatchning";
  if (taskType === "price_match_only") return "Prismatchning";
  if (taskType === "shopify_sync_only") return "Shopify-synk";
  if (taskType === "top_products_price_match") return "Bästsäljare";
  return taskType;
}

function formatScheduleScope(scopeType: string): string {
  if (scopeType === "ready") return "Redo för prismatchning";
  if (scopeType === "in_stock") return "Bara produkter med eget lager";
  if (scopeType === "all_active") return "Alla aktiva produkter";
  return scopeType;
}

function formatScheduleFrequency(schedule: Pick<Schedule, "frequency_type" | "time_of_day" | "interval_hours" | "weekday">): string {
  if (schedule.frequency_type === "hourly") {
    return `Var ${schedule.interval_hours ?? 6}:e timme`;
  }

  if (schedule.frequency_type === "weekly") {
    return `${weekdayLabel(schedule.weekday ?? 1)} ${schedule.time_of_day ?? "06:00"}`;
  }

  return `Dagligen ${schedule.time_of_day ?? "06:00"}`;
}

function weekdayLabel(value: number): string {
  const labels: Record<number, string> = {
    1: "måndag",
    2: "tisdag",
    3: "onsdag",
    4: "torsdag",
    5: "fredag",
    6: "lördag",
    7: "söndag"
  };

  return labels[value] ?? String(value);
}
