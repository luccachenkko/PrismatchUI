const state = {
  products: [],
  stats: null,
  priceRuns: [],
  selectedProductId: null,
  productDetail: null,
  report: null,
  productQuickFilters: [],
  productSearch: "",
  productSorts: [],
  reportQuickFilters: [],
  reportSearch: "",
  reportSorts: []
};

const views = document.querySelectorAll(".view");
const tabs = document.querySelectorAll(".tab");
const syncButton = document.querySelector("#syncButton");
const runPriceButton = document.querySelector("#runPriceButton");
const syncMessage = document.querySelector("#syncMessage");
const runMessage = document.querySelector("#runMessage");
const detailMessage = document.querySelector("#detailMessage");
const applyMessage = document.querySelector("#applyMessage");
const pricingRuleForm = document.querySelector("#pricingRuleForm");
const addLinkForm = document.querySelector("#addLinkForm");
const approveAllOkButton = document.querySelector("#approveAllOkButton");
const clearApprovalsButton = document.querySelector("#clearApprovalsButton");
const applyApprovedButton = document.querySelector("#applyApprovedButton");
const productControls = document.querySelector("#productControls");
const productFilterSummary = document.querySelector("#productFilterSummary");
const productFilterOptions = [...document.querySelectorAll(".product-filter-option")];
const productSearch = document.querySelector("#productSearch");
const productSortSummary = document.querySelector("#productSortSummary");
const productSortOptions = [...document.querySelectorAll(".product-sort-option")];
const productSortDirections = [...document.querySelectorAll(".product-sort-direction")];
const reportFilterSummary = document.querySelector("#reportFilterSummary");
const reportFilterOptions = [...document.querySelectorAll(".report-filter-option")];
const reportSearch = document.querySelector("#reportSearch");
const reportSortSummary = document.querySelector("#reportSortSummary");
const reportSortOptions = [...document.querySelectorAll(".report-sort-option")];
const reportSortDirections = [...document.querySelectorAll(".report-sort-direction")];

const statusSortOrder = new Map([
  ["OK", 0],
  ["BLOCKERAD_MARGINAL", 1],
  ["SAKNAR_INKOPSPRIS", 2],
  ["SAKNAR_LANKAR", 3],
  ["INGET_PRIS", 4],
  ["INGEN_ANDRING", 5],
  ["SKIPPAD_EGET_LAGER_0", 6]
]);

const reportStatusFilters = new Set([
  "OK",
  "INGEN_ANDRING",
  "SKIPPAD_EGET_LAGER_0",
  "SAKNAR_INKOPSPRIS",
  "SAKNAR_LANKAR",
  "INGET_PRIS",
  "BLOCKERAD_MARGINAL",
  "SHOPIFY_FEL"
]);

document.querySelector("#backToProducts").addEventListener("click", () => {
  showView("products");
});

document.querySelector("#backToRuns").addEventListener("click", async () => {
  await loadPriceRuns();
  showView("priceRuns");
});

approveAllOkButton.addEventListener("click", async () => {
  if (!state.report) {
    return;
  }
  try {
    const response = await fetch(`/api/price-runs/${state.report.run.id}/approve-all-ok`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "OK-rader kunde inte godkÃ¤nnas.");
    }
    setMessage(applyMessage, `${payload.approved_count} OK-rader godkÃ¤ndes.`, "success");
    await openRunReport(state.report.run.id);
  } catch (error) {
    setMessage(applyMessage, error instanceof Error ? error.message : String(error), "error");
  }
});

clearApprovalsButton.addEventListener("click", async () => {
  if (!state.report) {
    return;
  }
  try {
    const response = await fetch(`/api/price-runs/${state.report.run.id}/clear-approvals`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "GodkÃ¤nnanden kunde inte avmarkeras.");
    }
    setMessage(applyMessage, `${payload.cleared_count} rader avmarkerades.`, "success");
    await openRunReport(state.report.run.id);
  } catch (error) {
    setMessage(applyMessage, error instanceof Error ? error.message : String(error), "error");
  }
});

applyApprovedButton.addEventListener("click", async () => {
  if (!state.report) {
    return;
  }

  const confirmed = window.confirm("Ã„r du sÃ¤ker? Detta uppdaterar godkÃ¤nda priser i Shopify.");
  if (!confirmed) {
    return;
  }

  applyApprovedButton.disabled = true;
  try {
    const response = await fetch(`/api/price-runs/${state.report.run.id}/apply-approved`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "GodkÃ¤nda priser kunde inte uppdateras i Shopify.");
    }
    setMessage(
      applyMessage,
      `Shopify-uppdatering klar. Totalt: ${payload.total}. Uppdaterade: ${payload.success_count}. Fel: ${payload.error_count}.`,
      payload.error_count > 0 ? "warning" : "success"
    );
    await openRunReport(state.report.run.id);
  } catch (error) {
    setMessage(applyMessage, error instanceof Error ? error.message : String(error), "error");
  } finally {
    applyApprovedButton.disabled = false;
  }
});

productFilterOptions.forEach((option) => {
  option.addEventListener("change", () => {
    state.productQuickFilters = readCheckedValues(productFilterOptions);
    renderProducts();
  });
});

productSearch.addEventListener("input", () => {
  state.productSearch = productSearch.value.trim().toLowerCase();
  renderProducts();
});

productSortOptions.forEach((option) => {
  option.addEventListener("change", () => {
    state.productSorts = readSortDropdown(productSortOptions, productSortDirections);
    renderProducts();
  });
});

productSortDirections.forEach((direction) => {
  direction.addEventListener("change", () => {
    state.productSorts = readSortDropdown(productSortOptions, productSortDirections);
    renderProducts();
  });
});

reportFilterOptions.forEach((option) => {
  option.addEventListener("change", () => {
    state.reportQuickFilters = readCheckedValues(reportFilterOptions);
    renderRunReport();
  });
});

reportSearch.addEventListener("input", () => {
  state.reportSearch = reportSearch.value.trim().toLowerCase();
  renderRunReport();
});

reportSortOptions.forEach((option) => {
  option.addEventListener("change", () => {
    state.reportSorts = readSortDropdown(reportSortOptions, reportSortDirections);
    renderRunReport();
  });
});

reportSortDirections.forEach((direction) => {
  direction.addEventListener("change", () => {
    state.reportSorts = readSortDropdown(reportSortOptions, reportSortDirections);
    renderRunReport();
  });
});

for (const tab of tabs) {
  tab.addEventListener("click", async () => {
    if (tab.dataset.view === "priceRuns") {
      await loadPriceRuns();
    }
    showView(tab.dataset.view);
  });
}

syncButton.addEventListener("click", async () => {
  setMessage(syncMessage, "Synkar produkter frÃ¥n Shopify...", "");
  syncButton.disabled = true;
  try {
    const response = await fetch("/api/shopify/sync-products", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error([payload.error, payload.details].filter(Boolean).join(" "));
    }
    setMessage(syncMessage, `Synk klar. ${payload.syncedCount} produkter/varianter sparades.`, "success");
    await loadProducts();
  } catch (error) {
    setMessage(syncMessage, error instanceof Error ? error.message : String(error), "error");
  } finally {
    syncButton.disabled = false;
  }
});

runPriceButton.addEventListener("click", async () => {
  setMessage(runMessage, "KÃ¶r prismatchning...", "");
  runPriceButton.disabled = true;
  try {
    const response = await fetch("/api/price-runs", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Prismatchningen kunde inte kÃ¶ras.");
    }
    setMessage(runMessage, "Klar.", "success");
    await loadProducts();
    await loadPriceRuns();
    await openRunReport(payload.run.id);
  } catch (error) {
    setMessage(runMessage, `Fel: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    runPriceButton.disabled = false;
  }
});

pricingRuleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedProductId) {
    return;
  }

  try {
    const payload = {
      cost_price: optionalInputNumber("costPriceInput"),
      min_margin_percent: optionalInputNumber("minMarginInput"),
      undercut_amount: optionalInputNumber("undercutInput"),
      enabled: document.querySelector("#ruleEnabledInput").checked
    };

    const response = await fetch(`/api/products/${state.selectedProductId}/pricing-rule`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Regler kunde inte sparas.");
    }

    setDetailMessage("Regler sparade.", "success");
    await loadProductDetail(state.selectedProductId);
    await loadProducts();
  } catch (error) {
    setDetailMessage(error instanceof Error ? error.message : String(error), "error");
  }
});

addLinkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedProductId) {
    return;
  }

  try {
    const response = await fetch(`/api/products/${state.selectedProductId}/competitor-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: document.querySelector("#newLinkUrl").value,
        enabled: document.querySelector("#newLinkEnabled").checked
      })
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "KonkurrentlÃ¤nken kunde inte sparas.");
    }

    document.querySelector("#newLinkUrl").value = "";
    document.querySelector("#newLinkEnabled").checked = true;
    setDetailMessage(linkSavedMessage(body.competitorLink), body.competitorLink.scraper_supported ? "success" : "warning");
    await loadProductDetail(state.selectedProductId);
    await loadProducts();
  } catch (error) {
    setDetailMessage(error instanceof Error ? error.message : String(error), "error");
  }
});

await checkHealth();
await loadProducts();
await loadPriceRuns();

async function checkHealth() {
  const health = document.querySelector("#health");
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error("Backend svarade inte korrekt.");
    }
    health.textContent = "Backend Ã¤r igÃ¥ng.";
  } catch (error) {
    health.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function loadProducts() {
  const response = await fetch("/api/products");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Produkter kunde inte hÃ¤mtas.");
  }
  state.products = payload.products;
  state.stats = payload.stats;
  renderStats();
  renderProducts();
}

async function loadPriceRuns() {
  const response = await fetch("/api/price-runs");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "KÃ¶rningar kunde inte hÃ¤mtas.");
  }
  state.priceRuns = payload.runs;
  renderPriceRuns();
}

function renderStats() {
  const stats = state.stats ?? {};
  setText("productCount", stats.productCount ?? 0);
  setText("inStockCount", stats.inStockCount ?? 0);
  setText("missingCostPriceCount", stats.missingCostPriceCount ?? 0);
  setText("missingCompetitorLinksCount", stats.missingCompetitorLinksCount ?? 0);
  setText("latestRun", stats.latestRun ?? "-");
  setText("okRecommendationCount", stats.okRecommendationCount ?? 0);
  setText("blockedRecommendationCount", stats.blockedRecommendationCount ?? 0);
  setText("errorRecommendationCount", stats.errorRecommendationCount ?? 0);
}

function renderProducts() {
  const empty = document.querySelector("#emptyProducts");
  const tableWrap = document.querySelector("#productsTableWrap");
  const table = document.querySelector("#productsTable");
  const visibleProducts = getVisibleProducts();

  empty.hidden = state.products.length !== 0;
  productControls.hidden = state.products.length === 0;
  tableWrap.hidden = state.products.length === 0;
  syncFilterDropdown(productFilterOptions, state.productQuickFilters, productFilterSummary, "Snabbfilter");
  productSearch.value = state.productSearch;
  syncSortDropdown(productSortOptions, productSortDirections, state.productSorts, productSortSummary);
  setText("productVisibleCount", `Visar ${visibleProducts.length} av ${state.products.length} produkter`);
  table.replaceChildren();

  for (const product of visibleProducts) {
    const row = document.createElement("tr");
    row.append(
      cell(product.sku || "-"),
      cell(product.title),
      cell(formatMoney(product.shopify_price)),
      cell(product.inventory_quantity),
      cell(formatNullableMoney(product.cost_price)),
      cell(formatNullableNumber(product.min_margin_percent)),
      cell(formatNullableMoney(product.undercut_amount)),
      cell(product.competitor_link_count),
      cell(product.last_checked_at || "-"),
      statusCell(product.active === 1 ? "Aktiv" : "Inaktiv"),
      actionCell("Ã–ppna", () => openProduct(product.id))
    );
    table.append(row);
  }
}

function getVisibleProducts() {
  return state.products
    .filter((product) => matchesProductQuickFilter(product))
    .filter((product) => matchesProductSearch(product))
    .sort(compareProducts);
}

function matchesProductQuickFilter(product) {
  const filters = state.productQuickFilters;
  if (filters.length === 0) return true;

  const activeFilters = filters.filter((filter) => filter === "Aktiva" || filter === "Inaktiva");
  const stockFilters = filters.filter((filter) => filter === "Har lager" || filter === "Saknar lager");
  const linkFilters = filters.filter((filter) => filter === "Har konkurrentlänkar" || filter === "Saknar konkurrentlänkar");

  const activeMatches =
    activeFilters.length === 0 ||
    activeFilters.some((filter) => (filter === "Aktiva" ? product.active === 1 : product.active !== 1));
  const stockMatches =
    stockFilters.length === 0 ||
    stockFilters.some((filter) =>
      filter === "Har lager" ? Number(product.inventory_quantity ?? 0) > 0 : Number(product.inventory_quantity ?? 0) <= 0
    );
  const costMatches =
    !filters.includes("Saknar inköpspris") ||
    product.cost_price === null ||
    product.cost_price === undefined ||
    product.cost_price === "";
  const linkMatches =
    linkFilters.length === 0 ||
    linkFilters.some((filter) =>
      filter === "Har konkurrentlänkar"
        ? Number(product.competitor_link_count ?? 0) > 0
        : Number(product.competitor_link_count ?? 0) === 0
    );

  return activeMatches && stockMatches && costMatches && linkMatches;
}

function matchesProductSearch(product) {
  const query = state.productSearch;
  if (!query) return true;

  return [product.sku, product.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function compareProducts(a, b) {
  return compareBySorts(a, b, state.productSorts, getProductSortValue, compareDefaultProducts);
}

function compareDefaultProducts(a, b) {
  const titleCompared = compareValues(a.title || "", b.title || "");
  if (titleCompared !== 0) return titleCompared;
  return compareValues(a.sku || "", b.sku || "");
}

function getProductSortValue(product, key) {
  if (key === "active") return product.active === 1 ? "Aktiv" : "Inaktiv";
  return product[key];
}

function renderPriceRuns() {
  const empty = document.querySelector("#emptyRuns");
  const tableWrap = document.querySelector("#runsTableWrap");
  const table = document.querySelector("#runsTable");

  empty.hidden = state.priceRuns.length !== 0;
  tableWrap.hidden = state.priceRuns.length === 0;
  table.replaceChildren();

  for (const run of state.priceRuns) {
    const row = document.createElement("tr");
    row.append(
      cell(run.started_at),
      statusCell(run.status),
      cell(run.total_products),
      cell(run.total_links_checked),
      cell(run.success_count),
      cell(run.error_count),
      actionCell("Visa rapport", () => openRunReport(run.id))
    );
    table.append(row);
  }
}

async function openProduct(productId) {
  await loadProductDetail(productId);
  showView("productDetail");
}

async function loadProductDetail(productId) {
  const response = await fetch(`/api/products/${productId}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Produkten kunde inte hÃ¤mtas.");
  }

  state.selectedProductId = productId;
  state.productDetail = payload;
  renderProductDetail();
}

async function openRunReport(runId) {
  const response = await fetch(`/api/price-runs/${runId}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Rapporten kunde inte hÃ¤mtas.");
  }
  state.report = payload;
  renderRunReport();
  showView("runReport");
}

function renderProductDetail() {
  const detail = state.productDetail;
  const product = detail.product;
  const pricingRule = detail.pricingRule;

  setText("detailTitle", product.title);
  setText("detailSubtitle", product.sku || "-");
  setText("detailProductTitle", product.title);
  setText("detailSku", product.sku || "-");
  setText("detailProductId", product.shopify_product_id);
  setText("detailVariantId", product.shopify_variant_id);
  setText("detailPrice", formatMoney(product.shopify_price));
  setText("detailInventory", product.inventory_quantity);
  setText("detailVendor", product.vendor || "-");
  setText("detailBarcode", product.barcode || "-");
  setText("detailSynced", product.last_synced_at || "-");

  document.querySelector("#costPriceInput").value = pricingRule?.cost_price ?? "";
  document.querySelector("#minMarginInput").value = pricingRule?.min_margin_percent ?? "";
  document.querySelector("#undercutInput").value = pricingRule?.undercut_amount ?? "";
  document.querySelector("#ruleEnabledInput").checked = pricingRule ? pricingRule.enabled === 1 : true;

  renderCompetitorLinks();
}

function renderCompetitorLinks() {
  const links = state.productDetail.competitorLinks;
  const empty = document.querySelector("#emptyLinks");
  const tableWrap = document.querySelector("#linksTableWrap");
  const table = document.querySelector("#linksTable");

  empty.hidden = links.length !== 0;
  tableWrap.hidden = links.length === 0;
  table.replaceChildren();

  for (const link of links) {
    const row = document.createElement("tr");
    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.value = link.url;
    urlInput.className = "table-input";

    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = link.enabled === 1;

    row.append(
      inputCell(urlInput),
      cell(link.domain),
      scraperStatusCell(link),
      inputCell(enabledInput),
      cell(formatNullableMoney(link.last_price)),
      cell(link.last_error || "-"),
      actionCell("Spara", () => saveCompetitorLink(link.id, urlInput.value, enabledInput.checked)),
      actionCell("Ta bort", () => deleteLink(link.id), "danger-button")
    );
    table.append(row);
  }
}

function renderRunReport() {
  const report = state.report;
  setText("reportTitle", `Rapport #${report.run.id}`);
  setText("reportSubtitle", `${report.run.started_at} | ${report.run.status}`);
  renderReportSummary(report);

  syncFilterDropdown(reportFilterOptions, state.reportQuickFilters, reportFilterSummary, "Snabbfilter");
  reportSearch.value = state.reportSearch;
  syncSortDropdown(reportSortOptions, reportSortDirections, state.reportSorts, reportSortSummary);

  const visibleRecommendations = getVisibleRecommendations(report);
  setText("reportVisibleCount", `Visar ${visibleRecommendations.length} av ${report.recommendations.length} rader`);
  document.querySelector("#emptyRecommendations").hidden = report.recommendations.length !== 0;

  const recommendationsTable = document.querySelector("#recommendationsTable");
  recommendationsTable.replaceChildren();

  for (const recommendation of visibleRecommendations) {
    const row = document.createElement("tr");
    row.append(
      approvalCell(recommendation),
      cell(recommendation.sku || "-"),
      cell(recommendation.title),
      cell(formatNullableMoney(recommendation.shopify_price_before)),
      cell(recommendation.inventory_quantity),
      cell(recommendation.cheapest_competitor_domain || "-"),
      cell(formatNullableMoney(recommendation.cheapest_competitor_price)),
      cell(formatNullableMoney(recommendation.suggested_price)),
      cell(formatNullableMoney(recommendation.cost_price)),
      cell(formatNullablePercent(recommendation.margin_after_percent)),
      cell(formatNullableMoney(recommendation.min_allowed_price)),
      statusCell(recommendation.status),
      statusCell(recommendation.shopify_update_status || "not_updated"),
      cell(recommendation.reason)
    );
    recommendationsTable.append(row);
  }

  renderSnapshotDetails(report, visibleRecommendations);
  renderShopifyUpdatesLog(report);
}

function getVisibleRecommendations(report) {
  return report.recommendations
    .filter((recommendation) => matchesQuickFilter(recommendation))
    .filter((recommendation) => matchesReportSearch(report, recommendation))
    .sort(compareRecommendations);
}

function matchesQuickFilter(recommendation) {
  const filters = state.reportQuickFilters;
  if (filters.length === 0) return true;

  const statusFilters = filters.filter((filter) => reportStatusFilters.has(filter));
  const approvalFilters = filters.filter((filter) => filter === "Godkända" || filter === "Ej godkända");
  const updateFilters = filters.filter((filter) => filter === "Uppdaterade i Shopify" || filter === "Shopify-fel");

  const statusMatches = statusFilters.length === 0 || statusFilters.includes(recommendation.status);
  const approvalMatches =
    approvalFilters.length === 0 ||
    approvalFilters.some((filter) => (filter === "Godkända" ? recommendation.approved === 1 : recommendation.approved !== 1));
  const updateMatches =
    updateFilters.length === 0 ||
    updateFilters.some((filter) =>
      filter === "Uppdaterade i Shopify"
        ? recommendation.shopify_update_status === "success"
        : recommendation.shopify_update_status === "failed"
    );

  return statusMatches && approvalMatches && updateMatches;
}

function matchesReportSearch(report, recommendation) {
  const query = state.reportSearch;
  if (!query) return true;

  const snapshots = report.snapshots.filter((snapshot) => snapshot.product_id === recommendation.product_id);
  const haystack = [
    recommendation.sku,
    recommendation.title,
    recommendation.cheapest_competitor_domain,
    recommendation.cheapest_competitor_url,
    ...snapshots.flatMap((snapshot) => [snapshot.domain, snapshot.url])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function compareRecommendations(a, b) {
  return compareBySorts(a, b, state.reportSorts, getReportSortValue, compareDefaultRecommendations);
}

function compareDefaultRecommendations(a, b) {
  const statusCompared = compareValues(statusRank(a.status), statusRank(b.status));
  if (statusCompared !== 0) return statusCompared;

  const aChange = absolutePriceChange(a);
  const bChange = absolutePriceChange(b);
  if (aChange !== null && bChange !== null && aChange !== bChange) return bChange - aChange;
  if (aChange !== null && bChange === null) return -1;
  if (aChange === null && bChange !== null) return 1;

  return compareValues(a.sku || "", b.sku || "");
}

function getReportSortValue(recommendation, key) {
  if (key === "approved") return recommendation.approved === 1 ? 1 : 0;
  if (key === "shopify_update_status") return recommendation.shopify_update_status || "not_updated";
  return recommendation[key];
}

function compareBySorts(a, b, sorts, getValue, fallbackCompare) {
  for (const sort of sorts) {
    if (!sort.key) continue;
    if (sort.key === "default") {
      const compared = fallbackCompare(a, b);
      if (compared !== 0) return sort.direction === "desc" ? compared * -1 : compared;
      continue;
    }

    const direction = sort.direction === "desc" ? -1 : 1;
    const compared = compareValues(getValue(a, sort.key), getValue(b, sort.key));
    if (compared !== 0) return compared * direction;
  }

  return fallbackCompare(a, b);
}

function readCheckedValues(options) {
  return options.filter((option) => option.checked).map((option) => option.value);
}

function syncFilterDropdown(options, filters, summary, label) {
  const selected = new Set(filters);

  options.forEach((option) => {
    option.checked = selected.has(option.value);
  });

  summary.textContent = filters.length === 0 ? `${label}: Alla` : `${label}: ${filters.join(", ")}`;
}

function readSortDropdown(options, directions) {
  return options
    .filter((option) => option.checked)
    .map((option) => {
      const direction = directions.find((item) => item.dataset.key === option.dataset.key);
      return {
        key: option.dataset.key,
        direction: direction?.value ?? "asc"
      };
    });
}

function syncSortDropdown(options, directions, sorts, summary) {
  const selected = new Map(sorts.map((sort) => [sort.key, sort.direction]));

  options.forEach((option) => {
    option.checked = selected.has(option.dataset.key);
  });

  directions.forEach((direction) => {
    direction.value = selected.get(direction.dataset.key) ?? "asc";
  });

  const labels = options
    .filter((option) => option.checked)
    .map((option) => option.parentElement.textContent.trim().replace(/\s+/g, " ").split(" Stigande")[0].split(" Fallande")[0]);

  summary.textContent = labels.length === 0 ? "Sortering: Standard" : `Sortering: ${labels.join(", ")}`;
}

function statusRank(status) {
  return statusSortOrder.has(status) ? statusSortOrder.get(status) : 99;
}

function absolutePriceChange(recommendation) {
  if (recommendation.suggested_price === null || recommendation.shopify_price_before === null) {
    return null;
  }
  return Math.abs(recommendation.suggested_price - recommendation.shopify_price_before);
}

function compareValues(a, b) {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b), "sv-SE", { numeric: true, sensitivity: "base" });
}

function renderReportSummary(report) {
  const okCount = report.recommendations.filter((row) => row.status === "OK").length;
  const approvedCount = report.recommendations.filter((row) => row.approved === 1).length;
  const updatedCount = report.shopifyUpdates.filter((row) => row.status === "success").length;
  const errorCount = report.shopifyUpdates.filter((row) => row.status === "failed").length;

  setText("reportOkCount", okCount);
  setText("reportApprovedCount", approvedCount);
  setText("reportUpdatedCount", updatedCount);
  setText("reportUpdateErrorCount", errorCount);
}

function renderSnapshotDetails(report, recommendations = report.recommendations) {
  const container = document.querySelector("#snapshotDetails");
  container.replaceChildren();

  const visibleProductIds = new Set(recommendations.map((recommendation) => recommendation.product_id));
  const visibleSnapshots = report.snapshots.filter((snapshot) => visibleProductIds.has(snapshot.product_id));

  if (visibleSnapshots.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Inga konkurrentpriser hÃ¤mtades i denna kÃ¶rning.";
    container.append(empty);
    return;
  }

  for (const recommendation of recommendations) {
    const snapshots = visibleSnapshots.filter((snapshot) => snapshot.product_id === recommendation.product_id);
    if (snapshots.length === 0) {
      continue;
    }

    const panel = document.createElement("section");
    panel.className = "snapshot-group";
    const heading = document.createElement("h4");
    heading.textContent = `${recommendation.sku || "-"} | ${recommendation.title}`;
    panel.append(heading);

    const tableWrap = document.createElement("div");
    tableWrap.className = "table-wrap";
    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>URL</th>
          <th>DomÃ¤n</th>
          <th>Pris</th>
          <th>Status</th>
          <th>Fel</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    for (const snapshot of snapshots) {
      const row = document.createElement("tr");
      row.append(
        cell(snapshot.url),
        cell(snapshot.domain),
        cell(formatNullableMoney(snapshot.price)),
        statusCell(snapshot.status),
        cell(snapshot.error || "-")
      );
      tbody.append(row);
    }
    tableWrap.append(table);
    panel.append(tableWrap);
    container.append(panel);
  }
}

function renderShopifyUpdatesLog(report) {
  const container = document.querySelector("#shopifyUpdatesLog");
  container.replaceChildren();

  if (report.shopifyUpdates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Inga Shopify-uppdateringar har kÃ¶rts fÃ¶r denna rapport.";
    container.append(empty);
    return;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>SKU</th>
        <th>Produkt</th>
        <th>Variant ID</th>
        <th>Gammalt pris</th>
        <th>Nytt pris</th>
        <th>Status</th>
        <th>Fel</th>
        <th>Tid</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  for (const update of report.shopifyUpdates) {
    const row = document.createElement("tr");
    row.append(
      cell(update.sku || "-"),
      cell(update.title || "-"),
      cell(update.shopify_variant_id),
      cell(formatNullableMoney(update.old_price)),
      cell(formatNullableMoney(update.new_price)),
      statusCell(update.status),
      cell(update.error || "-"),
      cell(update.updated_at)
    );
    tbody.append(row);
  }
  tableWrap.append(table);
  container.append(tableWrap);
}

async function saveCompetitorLink(linkId, url, enabled) {
  try {
    const response = await fetch(`/api/competitor-links/${linkId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, enabled })
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "KonkurrentlÃ¤nken kunde inte sparas.");
    }

    setDetailMessage(linkSavedMessage(body.competitorLink), body.competitorLink.scraper_supported ? "success" : "warning");
    await loadProductDetail(state.selectedProductId);
    await loadProducts();
  } catch (error) {
    setDetailMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function deleteLink(linkId) {
  try {
    const response = await fetch(`/api/competitor-links/${linkId}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "KonkurrentlÃ¤nken kunde inte tas bort.");
    }

    setDetailMessage("KonkurrentlÃ¤nken togs bort.", "success");
    await loadProductDetail(state.selectedProductId);
    await loadProducts();
  } catch (error) {
    setDetailMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

function cell(value) {
  const td = document.createElement("td");
  td.textContent = String(value);
  return td;
}

function approvalCell(recommendation) {
  const td = document.createElement("td");
  if (recommendation.status !== "OK") {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = "Kan ej godkÃ¤nnas";
    td.append(span);
    return td;
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = recommendation.approved === 1;
  checkbox.addEventListener("change", async () => {
    try {
      const response = await fetch(`/api/price-recommendations/${recommendation.id}/approval`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: checkbox.checked })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Raden kunde inte godkÃ¤nnas.");
      }
      await openRunReport(state.report.run.id);
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      setMessage(applyMessage, error instanceof Error ? error.message : String(error), "error");
    }
  });
  td.append(checkbox);
  return td;
}

function inputCell(input) {
  const td = document.createElement("td");
  td.append(input);
  return td;
}

function actionCell(label, onClick, className = "secondary-button") {
  const td = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  td.append(button);
  return td;
}

function statusCell(value) {
  const td = cell("");
  const span = document.createElement("span");
  span.className = `status status-${String(value).toLowerCase()}`;
  span.textContent = value;
  td.append(span);
  return td;
}

function scraperStatusCell(link) {
  const td = document.createElement("td");
  const span = document.createElement("span");
  span.className = link.scraper_supported ? "status success-text" : "status warning-text";
  span.textContent = link.scraper_supported ? "Scraper finns" : "Ingen scraper finns fÃ¶r denna domÃ¤n.";
  td.append(span);
  return td;
}

function showView(viewName) {
  for (const tab of tabs) {
    tab.classList.toggle("is-active", tab.dataset.view === viewName);
  }
  for (const view of views) {
    view.hidden = view.id !== viewName;
  }
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = String(value);
}

function setDetailMessage(text, className) {
  setMessage(detailMessage, text, className);
}

function setMessage(element, text, className) {
  element.hidden = false;
  element.className = ["message", className].filter(Boolean).join(" ");
  element.textContent = text;
}

function optionalInputNumber(id) {
  const value = document.querySelector(`#${id}`).value.trim();
  return value === "" ? null : Number(value);
}

function linkSavedMessage(link) {
  if (link.scraper_supported) {
    return "KonkurrentlÃ¤nken sparades.";
  }

  return "KonkurrentlÃ¤nken sparades. Ingen scraper finns fÃ¶r denna domÃ¤n.";
}

function formatMoney(value) {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(value);
}

function formatNullableMoney(value) {
  return value === null || value === undefined ? "-" : formatMoney(value);
}

function formatNullableNumber(value) {
  return value === null || value === undefined ? "-" : String(value);
}

function formatNullablePercent(value) {
  return value === null || value === undefined ? "-" : `${value} %`;
}


