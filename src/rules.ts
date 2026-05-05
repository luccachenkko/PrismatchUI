import { roundMoney } from "./money.js";
import type { ProductInput, Recommendation, ScrapedPriceResult, ShopifyVariantState } from "./types.js";

export function calculateRecommendation(params: {
  product: ProductInput;
  shopifyState: ShopifyVariantState | null;
  shopifyError?: string;
  scrapedPrices: ScrapedPriceResult[];
  timestamp?: string;
}): Recommendation {
  const { product, shopifyState, shopifyError, scrapedPrices } = params;
  const timestamp = params.timestamp ?? new Date().toISOString();
  const minAllowedPrice = roundMoney(product.inkopspris / (1 - product.minMarginalProcent / 100));
  const productName = shopifyState?.productTitle || product.produktnamn || product.sku;

  if (shopifyError || !shopifyState) {
    return baseRecommendation(product, {
      produktnamn: productName,
      shopifyLager: null,
      shopifyPrisNu: null,
      minstaTillatnaPris: minAllowedPrice,
      status: "SHOPIFY_FEL",
      orsak: shopifyError ?? "Kunde inte hamta produkten fran Shopify.",
      timestamp
    });
  }

  if (shopifyState.inventoryQuantity <= 0) {
    return baseRecommendation(product, {
      produktnamn: productName,
      shopifyLager: shopifyState.inventoryQuantity,
      shopifyPrisNu: shopifyState.price,
      minstaTillatnaPris: minAllowedPrice,
      status: "SKIPPAD_EGET_LAGER_0",
      orsak: "Produkten finns inte i lager i din Shopify-butik. Konkurrentlankar hamtades inte.",
      timestamp
    });
  }

  const validPrices = scrapedPrices.filter(
    (result) => result.status === "success" && typeof result.price === "number" && result.price > 0
  );

  if (validPrices.length === 0) {
    return baseRecommendation(product, {
      produktnamn: productName,
      shopifyLager: shopifyState.inventoryQuantity,
      shopifyPrisNu: shopifyState.price,
      minstaTillatnaPris: minAllowedPrice,
      status: "INGET_PRIS",
      orsak: "Inget giltigt konkurrentpris kunde hamtas.",
      timestamp
    });
  }

  const cheapest = validPrices.reduce((lowest, current) => {
    if (lowest.price === null) {
      return current;
    }
    return current.price !== null && current.price < lowest.price ? current : lowest;
  });

  const cheapestPrice = cheapest.price as number;
  const suggestedPrice = roundMoney(cheapestPrice - product.undercutKr);
  const marginAfter = roundMoney(((suggestedPrice - product.inkopspris) / suggestedPrice) * 100);
  const priceChangeKr = roundMoney(suggestedPrice - shopifyState.price);
  const priceChangePercent = roundMoney((priceChangeKr / shopifyState.price) * 100);

  if (suggestedPrice < minAllowedPrice) {
    return {
      ...baseRecommendation(product, {
        produktnamn: productName,
        shopifyLager: shopifyState.inventoryQuantity,
        shopifyPrisNu: shopifyState.price,
        minstaTillatnaPris: minAllowedPrice,
        status: "BLOCKERAD_MARGINAL",
        orsak: "Foreslaget pris gar under minsta marginal.",
        timestamp
      }),
      billigasteKonkurrent: cheapest.competitor,
      billigasteUrl: cheapest.url,
      billigasteKonkurrentpris: cheapestPrice,
      foreslagetPris: suggestedPrice,
      marginalEfterProcent: marginAfter,
      prisandringKr: priceChangeKr,
      prisandringProcent: priceChangePercent
    };
  }

  if (roundMoney(shopifyState.price) === suggestedPrice) {
    return {
      ...baseRecommendation(product, {
        produktnamn: productName,
        shopifyLager: shopifyState.inventoryQuantity,
        shopifyPrisNu: shopifyState.price,
        minstaTillatnaPris: minAllowedPrice,
        status: "INGEN_ANDRING",
        orsak: "Shopify-priset ligger redan pa foreslaget pris.",
        timestamp
      }),
      billigasteKonkurrent: cheapest.competitor,
      billigasteUrl: cheapest.url,
      billigasteKonkurrentpris: cheapestPrice,
      foreslagetPris: suggestedPrice,
      marginalEfterProcent: marginAfter,
      prisandringKr: priceChangeKr,
      prisandringProcent: priceChangePercent
    };
  }

  return {
    ...baseRecommendation(product, {
      produktnamn: productName,
      shopifyLager: shopifyState.inventoryQuantity,
      shopifyPrisNu: shopifyState.price,
      minstaTillatnaPris: minAllowedPrice,
      status: "OK",
      orsak: `Billigaste konkurrent ar ${cheapest.competitor} med ${cheapestPrice} kr. Foreslaget pris ar ${suggestedPrice} kr.`,
      timestamp
    }),
    billigasteKonkurrent: cheapest.competitor,
    billigasteUrl: cheapest.url,
    billigasteKonkurrentpris: cheapestPrice,
    foreslagetPris: suggestedPrice,
    marginalEfterProcent: marginAfter,
    prisandringKr: priceChangeKr,
    prisandringProcent: priceChangePercent
  };
}

function baseRecommendation(
  product: ProductInput,
  values: Pick<
    Recommendation,
    | "produktnamn"
    | "shopifyLager"
    | "shopifyPrisNu"
    | "minstaTillatnaPris"
    | "status"
    | "orsak"
    | "timestamp"
  >
): Recommendation {
  return {
    sku: product.sku,
    produktnamn: values.produktnamn,
    shopifyProductId: product.shopifyProductId,
    shopifyVariantId: product.shopifyVariantId,
    shopifyLager: values.shopifyLager,
    shopifyPrisNu: values.shopifyPrisNu,
    billigasteKonkurrent: null,
    billigasteUrl: null,
    billigasteKonkurrentpris: null,
    foreslagetPris: null,
    inkopspris: product.inkopspris,
    marginalEfterProcent: null,
    minstaTillatnaPris: values.minstaTillatnaPris,
    prisandringKr: null,
    prisandringProcent: null,
    status: values.status,
    orsak: values.orsak,
    godkand: "",
    timestamp: values.timestamp
  };
}
