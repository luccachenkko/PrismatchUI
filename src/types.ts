export type ProductInput = {
  sku: string;
  produktnamn?: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  inkopspris: number;
  minMarginalProcent: number;
  undercutKr: number;
  aktiv: boolean;
};

export type LinkInput = {
  sku: string;
  url: string;
  aktiv: boolean;
};

export type ShopifyVariantState = {
  sku: string | null;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  price: number;
  inventoryQuantity: number;
};

export type ScrapedPriceResult = {
  sku: string;
  url: string;
  competitor: string;
  price: number | null;
  status: "success" | "failed";
  error?: string;
  fetchedAt: string;
};

export type RecommendationStatus =
  | "OK"
  | "INGEN_ANDRING"
  | "SKIPPAD_EGET_LAGER_0"
  | "INGET_PRIS"
  | "BLOCKERAD_MARGINAL"
  | "SHOPIFY_FEL";

export type Recommendation = {
  sku: string;
  produktnamn: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  shopifyLager: number | null;
  shopifyPrisNu: number | null;
  billigasteKonkurrent: string | null;
  billigasteUrl: string | null;
  billigasteKonkurrentpris: number | null;
  foreslagetPris: number | null;
  inkopspris: number;
  marginalEfterProcent: number | null;
  minstaTillatnaPris: number;
  prisandringKr: number | null;
  prisandringProcent: number | null;
  status: RecommendationStatus;
  orsak: string;
  godkand: string;
  timestamp: string;
};

export type ShopifyUpdateRequest = {
  sku: string;
  productId: string;
  variantId: string;
  oldPrice: number;
  newPrice: number;
};

export type ShopifyUpdateResult = {
  sku: string;
  variantId: string;
  oldPrice: number;
  newPrice: number;
  status: "updated" | "failed";
  error?: string;
  updatedAt: string;
};
