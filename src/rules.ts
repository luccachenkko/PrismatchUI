import { roundMoney } from "./money.js";
import { calculateMinAllowedPrice, calculateTb1, type VatMode } from "./vat.js";
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
  const costPriceVatMode: VatMode = product.costPriceVatMode ?? "ex_vat";
  const salesPriceVatMode: VatMode = product.salesPriceVatMode ?? "inc_vat";
  const vatPercent = product.vatPercent ?? 25;
  const minAllowed = calculateMinAllowedPrice({
    costPrice: product.inkopspris,
    costPriceVatMode,
    salesPriceVatMode,
    vatPercent,
    minMarginPercent: product.minMarginalProcent
  });
  const productName = shopifyState?.productTitle || product.produktnamn || product.sku;

  if (shopifyError || !shopifyState) {
    return baseRecommendation(product, {
      produktnamn: productName,
      shopifyLager: null,
      shopifyPrisNu: null,
      minstaTillatnaPris: minAllowed.minAllowedPrice,
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
      minstaTillatnaPris: minAllowed.minAllowedPrice,
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
      minstaTillatnaPris: minAllowed.minAllowedPrice,
      status: "INGET_PRIS",
      orsak: "Inget giltigt konkurrentpris kunde hamtas.",
      timestamp
    });
  }

  const candidates = validPrices.map((priceResult) => {
    const competitorPrice = priceResult.price as number;
    const suggestedPrice = roundMoney(competitorPrice - product.undercutKr);
    const tb1 = calculateTb1({
      sellingPrice: suggestedPrice,
      salesPriceVatMode,
      costPrice: product.inkopspris,
      costPriceVatMode,
      vatPercent
    });
    return { priceResult, competitorPrice, suggestedPrice, tb1 };
  });

  const cheapestOverall = candidates.reduce((lowest, current) =>
    current.competitorPrice < lowest.competitorPrice ? current : lowest
  );
  const eligibleCandidates = candidates.filter((candidate) => candidate.tb1.sellingPriceExVat >= minAllowed.minAllowedPriceExVat);

  const cheapest = eligibleCandidates.length > 0
    ? eligibleCandidates.reduce((lowest, current) => current.suggestedPrice < lowest.suggestedPrice ? current : lowest)
    : cheapestOverall;

  const cheapestPrice = cheapest.competitorPrice;
  const suggestedPrice = cheapest.suggestedPrice;
  const tb1Percent = cheapest.tb1.tb1Percent;
  const priceChangeKr = roundMoney(suggestedPrice - shopifyState.price);
  const priceChangePercent = roundMoney((priceChangeKr / shopifyState.price) * 100);

  if (eligibleCandidates.length === 0) {
    return {
      ...baseRecommendation(product, {
        produktnamn: productName,
        shopifyLager: shopifyState.inventoryQuantity,
        shopifyPrisNu: shopifyState.price,
        minstaTillatnaPris: minAllowed.minAllowedPrice,
        status: "BLOCKERAD_MARGINAL",
        orsak: "Foreslaget pris gar under minsta TB1.",
        timestamp
      }),
      billigasteKonkurrent: cheapest.priceResult.competitor,
      billigasteUrl: cheapest.priceResult.url,
      billigasteKonkurrentpris: cheapestPrice,
      foreslagetPris: suggestedPrice,
      marginalEfterProcent: tb1Percent,
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
        minstaTillatnaPris: minAllowed.minAllowedPrice,
        status: "INGEN_ANDRING",
        orsak: "Shopify-priset ligger redan pa foreslaget pris.",
        timestamp
      }),
      billigasteKonkurrent: cheapest.priceResult.competitor,
      billigasteUrl: cheapest.priceResult.url,
      billigasteKonkurrentpris: cheapestPrice,
      foreslagetPris: suggestedPrice,
      marginalEfterProcent: tb1Percent,
      prisandringKr: priceChangeKr,
      prisandringProcent: priceChangePercent
    };
  }

  return {
    ...baseRecommendation(product, {
      produktnamn: productName,
      shopifyLager: shopifyState.inventoryQuantity,
      shopifyPrisNu: shopifyState.price,
      minstaTillatnaPris: minAllowed.minAllowedPrice,
      status: "OK",
      orsak: `Billigaste konkurrent ar ${cheapest.priceResult.competitor} med ${cheapestPrice} kr. Foreslaget pris ar ${suggestedPrice} kr.`,
      timestamp
    }),
    billigasteKonkurrent: cheapest.priceResult.competitor,
    billigasteUrl: cheapest.priceResult.url,
    billigasteKonkurrentpris: cheapestPrice,
    foreslagetPris: suggestedPrice,
    marginalEfterProcent: tb1Percent,
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
