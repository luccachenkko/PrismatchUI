# AGENTS.md

## Project context

This repository contains a real Shopify price-matching MVP.

The current system:
- Reads local product/link input files.
- Fetches Shopify product price and inventory through Shopify Admin GraphQL.
- Uses Shopify Dev Dashboard client credentials flow.
- Fetches real competitor prices from real product URLs.
- Creates price recommendations.
- Updates Shopify only after manual approval.

The next goal is to build a local UI around the existing working price-matching engine.

## Absolute rules

Do not use:
- mock data
- fake data
- demo products
- hardcoded products
- hardcoded prices
- hardcoded Shopify IDs
- hardcoded competitor URLs
- fallback data that pretends to be real data

All product data must come from:
1. Shopify GraphQL Admin API
2. the local database
3. real scraper results from real competitor URLs

If Shopify fails, show a real error.
If the database is empty, show an empty state.
If a scraper is missing, show a real error.
Do not silently fall back to fake data.

## Security

- Never expose Client Secret to frontend code.
- Never commit `.env`.
- Shopify calls must run on the backend only.
- Shopify price updates must only run after user approval.
- Do not log full secrets or access tokens.

## Shopify

Use the new Shopify Dev Dashboard client credentials flow:
- SHOPIFY_SHOP_DOMAIN
- SHOPIFY_CLIENT_ID
- SHOPIFY_CLIENT_SECRET

Required scopes:
- read_products
- write_products
- read_inventory

Use GraphQL Admin API.
Use productVariantsBulkUpdate for price updates.

## Price-matching rules

Rules:
1. Only active products are considered.
2. Fetch current Shopify price and inventory from Shopify.
3. If own Shopify inventory is 0 or less, skip the product.
4. Competitor stock status must not be fetched or used.
5. Scrapers only fetch price.
6. For each product, fetch all active competitor URLs.
7. Pick the lowest valid competitor price.
8. suggested_price = lowest_competitor_price - undercut_kr.
9. min_allowed_price = cost_price / (1 - min_margin_percent / 100).
10. If suggested_price is below min_allowed_price, block with BLOCKERAD_MARGINAL.
11. If suggested_price equals current Shopify price, mark INGEN_ANDRING.
12. If valid and different, mark OK.
13. Shopify is updated only when recommendation status is OK and the user approved it.

There must be no max-price-drop rule.

## Development approach

Work in small steps.
Do not rebuild the entire app at once.
Preserve the existing working CLI behavior unless explicitly asked to change it.
After changes, run:
- npm run check-prices if possible
- npm run apply-approved only if explicitly safe and approved
- npm run build or npm run typecheck if scripts exist

If a command cannot run because .env or credentials are missing, say that clearly.