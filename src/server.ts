import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCompetitorLink,
  deleteCompetitorLink,
  getDashboardStats,
  getDatabase,
  getProductDetail,
  listProducts,
  updateCompetitorLink,
  upsertPricingRule,
  upsertProductsFromShopify,
  type CompetitorLinkInput,
  type PricingRuleInput
} from "./db.js";
import { loadDotEnv } from "./env.js";
import {
  applyApprovedRecommendations,
  approveAllOk,
  clearApprovals,
  getPriceRunReport,
  getShopifyUpdatesForRun,
  listPriceRuns,
  setRecommendationApproval,
  startPriceRun
} from "./priceRuns.js";
import { fetchShopifyCatalogProducts } from "./shopify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");

loadDotEnv(path.join(projectRoot, ".env"));
const preferredPort = Number.parseInt(process.env.PORT ?? "3000", 10);
getDatabase();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: "Internt serverfel.", details: message });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    server.listen(0, "::", () => {
      const address = server.address() as AddressInfo;
      console.log(`Port ${preferredPort} används redan.`);
      console.log(`Prismatch UI körs på http://localhost:${address.port}`);
    });
    return;
  }

  throw error;
});

server.listen(preferredPort, "::", () => {
  const address = server.address() as AddressInfo;
  console.log(`Prismatch UI körs på http://localhost:${address.port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${preferredPort}`}`);

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/products") {
    sendJson(response, 200, { products: listProducts(), stats: getDashboardStats() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/price-runs") {
    try {
      const run = await startPriceRun();
      sendJson(response, 201, { run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message.includes("pågår redan") ? 409 : 500;
      sendJson(response, statusCode, { error: message });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/price-runs") {
    sendJson(response, 200, { runs: listPriceRuns() });
    return;
  }

  const priceRunMatch = url.pathname.match(/^\/api\/price-runs\/(\d+)$/);
  if (method === "GET" && priceRunMatch) {
    const report = getPriceRunReport(Number(priceRunMatch[1]));
    if (!report) {
      sendJson(response, 404, { error: "Körningen hittades inte." });
      return;
    }

    sendJson(response, 200, report);
    return;
  }

  const approveAllMatch = url.pathname.match(/^\/api\/price-runs\/(\d+)\/approve-all-ok$/);
  if (method === "POST" && approveAllMatch) {
    try {
      sendJson(response, 200, approveAllOk(Number(approveAllMatch[1])));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const clearApprovalsMatch = url.pathname.match(/^\/api\/price-runs\/(\d+)\/clear-approvals$/);
  if (method === "POST" && clearApprovalsMatch) {
    try {
      sendJson(response, 200, clearApprovals(Number(clearApprovalsMatch[1])));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const applyApprovedMatch = url.pathname.match(/^\/api\/price-runs\/(\d+)\/apply-approved$/);
  if (method === "POST" && applyApprovedMatch) {
    try {
      const result = await applyApprovedRecommendations(Number(applyApprovedMatch[1]));
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const shopifyUpdatesMatch = url.pathname.match(/^\/api\/price-runs\/(\d+)\/shopify-updates$/);
  if (method === "GET" && shopifyUpdatesMatch) {
    try {
      sendJson(response, 200, { updates: getShopifyUpdatesForRun(Number(shopifyUpdatesMatch[1])) });
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/price-recommendations\/(\d+)\/approval$/);
  if (method === "PATCH" && approvalMatch) {
    try {
      const body = await readJsonBody<{ approved?: unknown }>(request);
      if (typeof body.approved !== "boolean") {
        throw new Error("Fältet approved måste vara boolean.");
      }
      const recommendation = setRecommendationApproval(Number(approvalMatch[1]), body.approved);
      sendJson(response, 200, { recommendation });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "Endast OK-rader kan godkännas." || message.includes("approved") ? 400 : 404;
      sendJson(response, statusCode, { error: message });
    }
    return;
  }

  const productDetailMatch = url.pathname.match(/^\/api\/products\/(\d+)$/);
  if (method === "GET" && productDetailMatch) {
    const detail = getProductDetail(Number(productDetailMatch[1]));
    if (!detail) {
      sendJson(response, 404, { error: "Produkten hittades inte." });
      return;
    }

    sendJson(response, 200, detail);
    return;
  }

  const pricingRuleMatch = url.pathname.match(/^\/api\/products\/(\d+)\/pricing-rule$/);
  if (method === "PUT" && pricingRuleMatch) {
    try {
      const body = await readJsonBody<PricingRuleInput>(request);
      const pricingRule = upsertPricingRule(Number(pricingRuleMatch[1]), {
        cost_price: normalizeOptionalNumber(body.cost_price),
        min_margin_percent: normalizeOptionalNumber(body.min_margin_percent),
        undercut_amount: normalizeOptionalNumber(body.undercut_amount),
        enabled: Boolean(body.enabled)
      });
      sendJson(response, 200, { pricingRule });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const productLinkMatch = url.pathname.match(/^\/api\/products\/(\d+)\/competitor-links$/);
  if (method === "POST" && productLinkMatch) {
    try {
      const body = await readJsonBody<CompetitorLinkInput>(request);
      const competitorLink = createCompetitorLink(Number(productLinkMatch[1]), {
        url: requireBodyString(body.url, "url"),
        enabled: Boolean(body.enabled)
      });
      sendJson(response, 201, { competitorLink });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const linkMatch = url.pathname.match(/^\/api\/competitor-links\/(\d+)$/);
  if (method === "PUT" && linkMatch) {
    try {
      const body = await readJsonBody<CompetitorLinkInput>(request);
      const competitorLink = updateCompetitorLink(Number(linkMatch[1]), {
        url: requireBodyString(body.url, "url"),
        enabled: Boolean(body.enabled)
      });
      sendJson(response, 200, { competitorLink });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === "DELETE" && linkMatch) {
    try {
      deleteCompetitorLink(Number(linkMatch[1]));
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/shopify/sync-products") {
    try {
      const products = await fetchShopifyCatalogProducts();
      const syncedCount = upsertProductsFromShopify(products);
      sendJson(response, 200, { syncedCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 502, {
        error: "Shopify-produkter kunde inte hämtas.",
        details: message
      });
    }
    return;
  }

  if (method === "GET") {
    await serveStatic(url.pathname, response);
    return;
  }

  sendJson(response, 405, { error: "Metoden stöds inte." });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {} as T;
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error("Ogiltig JSON.");
  }
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function requireBodyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Fältet ${fieldName} krävs.`);
  }
  return value;
}

async function serveStatic(rawPathname: string, response: ServerResponse): Promise<void> {
  const pathname = rawPathname === "/" ? "/index.html" : rawPathname;
  const decodedPath = decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(publicDir, decodedPath));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(response, 404, { error: "Hittades inte." });
    return;
  }

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    sendJson(response, 404, { error: "Hittades inte." });
    return;
  }

  response.writeHead(200, { "content-type": contentTypeFor(filePath) });
  createReadStream(filePath).pipe(response);
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
