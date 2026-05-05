import { getEnvNumber, requireEnv } from "./env.js";
import { mapWithConcurrency } from "./concurrency.js";
import { roundMoney } from "./money.js";
import type { ProductInput, ShopifyUpdateRequest, ShopifyUpdateResult, ShopifyVariantState } from "./types.js";

const SHOPIFY_API_VERSION = "2026-04";

type ShopifyTokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GraphQlError = { message: string };

type GraphQlResponse<T> = {
  data?: T;
  errors?: GraphQlError[];
};

type NodesResponse = {
  nodes: Array<
    | {
        __typename: "ProductVariant";
        id: string;
        title: string;
        sku: string | null;
        price: string;
        inventoryQuantity: number | null;
        product: {
          id: string;
          title: string;
        };
      }
    | null
  >;
};

type ProductVariantsBulkUpdateResponse = {
  productVariantsBulkUpdate: {
    productVariants: Array<{ id: string; price: string }>;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

export function getShopDomain(): string {
  return requireEnv("SHOPIFY_SHOP_DOMAIN");
}

export async function fetchShopifyVariantStates(
  products: ProductInput[]
): Promise<Map<string, ShopifyVariantState>> {
  const shopDomain = getShopDomain();
  const result = new Map<string, ShopifyVariantState>();
  const productsByVariantId = new Map(products.map((product) => [product.shopifyVariantId, product]));
  const chunks = chunkArray(products.map((product) => product.shopifyVariantId), 100);

  for (const ids of chunks) {
    const payload = await shopifyGraphQl<NodesResponse>(shopDomain, {
      query: `
        query GetVariantStates($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on ProductVariant {
              id
              title
              sku
              price
              inventoryQuantity
              product {
                id
                title
              }
            }
          }
        }
      `,
      variables: { ids }
    });

    for (const node of payload.nodes) {
      if (!node || node.__typename !== "ProductVariant") {
        continue;
      }

      const product = productsByVariantId.get(node.id);
      if (!product) {
        continue;
      }

      result.set(product.sku, {
        sku: node.sku,
        productId: node.product.id,
        variantId: node.id,
        productTitle: node.product.title,
        variantTitle: node.title,
        price: roundMoney(Number.parseFloat(node.price)),
        inventoryQuantity: node.inventoryQuantity ?? 0
      });
    }
  }

  return result;
}

export async function updateShopifyPrices(
  updates: ShopifyUpdateRequest[],
  options?: { onProgress?: (result: ShopifyUpdateResult) => void }
): Promise<ShopifyUpdateResult[]> {
  const shopDomain = getShopDomain();
  const concurrency = getEnvNumber("SHOPIFY_UPDATE_CONCURRENCY", 3);

  return mapWithConcurrency(updates, concurrency, async (update) => {
    const updatedAt = new Date().toISOString();
    let updateResult: ShopifyUpdateResult;

    try {
      const payload = await shopifyGraphQl<ProductVariantsBulkUpdateResponse>(shopDomain, {
        query: `
          mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
                price
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          productId: update.productId,
          variants: [
            {
              id: update.variantId,
              price: update.newPrice.toFixed(2)
            }
          ]
        }
      });

      const result = payload.productVariantsBulkUpdate;
      if (result.userErrors.length > 0) {
        throw new Error(result.userErrors.map((error) => error.message).join("; "));
      }

      updateResult = {
        sku: update.sku,
        variantId: update.variantId,
        oldPrice: update.oldPrice,
        newPrice: update.newPrice,
        status: "updated",
        updatedAt
      };
    } catch (error) {
      updateResult = {
        sku: update.sku,
        variantId: update.variantId,
        oldPrice: update.oldPrice,
        newPrice: update.newPrice,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt
      };
    }

    options?.onProgress?.(updateResult);
    return updateResult;
  });
}

async function shopifyGraphQl<T>(
  shopDomain: string,
  body: { query: string; variables?: Record<string, unknown> }
): Promise<T> {
  const token = await getShopifyAdminAccessToken(shopDomain);
  const endpoint = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": token
    },
    body: JSON.stringify(body)
  });

  const payload = await readJsonResponse<GraphQlResponse<T>>(response, "Shopify GraphQL");

  if (!response.ok) {
    throw new Error(`Shopify GraphQL svarade ${response.status}: ${JSON.stringify(payload)}`);
  }

  if (payload.errors?.length) {
    throw new Error(`Shopify GraphQL-fel: ${payload.errors.map((error) => error.message).join("; ")}`);
  }

  if (!payload.data) {
    throw new Error(`Shopify GraphQL saknar data: ${JSON.stringify(payload)}`);
  }

  return payload.data;
}

async function getShopifyAdminAccessToken(shopDomain: string): Promise<string> {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const directAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();

  if (clientId && clientSecret) {
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
      return cachedAccessToken;
    }

    const tokenEndpoint = `https://${shopDomain}/admin/oauth/access_token`;
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    const payload = await readJsonResponse<ShopifyTokenResponse>(response, "Shopify token");

    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Kunde inte hamta Shopify access token. Status ${response.status}: ${JSON.stringify(payload)}`
      );
    }

    cachedAccessToken = payload.access_token;
    cachedAccessTokenExpiresAt = Date.now() + (payload.expires_in ?? 86_399) * 1000;
    if (process.env.DEBUG_SHOPIFY_TOKEN === "1") {
      console.log(`Shopify token OK. Scope: ${payload.scope ?? "okand"}.`);
    }
    return cachedAccessToken;
  }

  if (directAccessToken) {
    if (directAccessToken.startsWith("shpss_")) {
      throw new Error(
        "SHOPIFY_ADMIN_ACCESS_TOKEN innehaller en Client Secret som borjar med shpss_. Anvand SHOPIFY_CLIENT_ID och SHOPIFY_CLIENT_SECRET i stallet."
      );
    }
    return directAccessToken;
  }

  throw new Error(
    "Shopify credentials saknas. Satt SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID och SHOPIFY_CLIENT_SECRET i .env."
  );
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} svarade inte med JSON. HTTP ${response.status}. Preview: ${text.slice(0, 300)}`);
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
