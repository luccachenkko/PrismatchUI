import { roundMoney } from "./money.js";

export type VatMode = "ex_vat" | "inc_vat";

export type Tb1Calculation = {
  sellingPriceExVat: number;
  sellingPriceIncVat: number;
  costPriceExVat: number;
  costPriceIncVat: number;
  tb1Amount: number;
  tb1Percent: number | null;
};

export type MinAllowedPriceCalculation = {
  minAllowedPrice: number;
  minAllowedPriceExVat: number;
  minAllowedPriceIncVat: number;
};

export function normalizeVatMode(value: unknown, fallback: VatMode): VatMode {
  return value === "ex_vat" || value === "inc_vat" ? value : fallback;
}

export function toExVat(amount: number, vatPercent: number, vatMode: VatMode): number {
  if (vatMode === "ex_vat") {
    return roundMoney(amount);
  }
  return roundMoney(amount / vatFactor(vatPercent));
}

export function fromExVat(amountExVat: number, vatPercent: number, vatMode: VatMode): number {
  if (vatMode === "ex_vat") {
    return roundMoney(amountExVat);
  }
  return roundMoney(amountExVat * vatFactor(vatPercent));
}

export function toIncVat(amount: number, vatPercent: number, vatMode: VatMode): number {
  if (vatMode === "inc_vat") {
    return roundMoney(amount);
  }
  return roundMoney(amount * vatFactor(vatPercent));
}

export function calculateTb1(params: {
  sellingPrice: number;
  salesPriceVatMode: VatMode;
  costPrice: number;
  costPriceVatMode: VatMode;
  vatPercent: number;
}): Tb1Calculation {
  const sellingPriceExVat = toExVat(params.sellingPrice, params.vatPercent, params.salesPriceVatMode);
  const sellingPriceIncVat = toIncVat(params.sellingPrice, params.vatPercent, params.salesPriceVatMode);
  const costPriceExVat = toExVat(params.costPrice, params.vatPercent, params.costPriceVatMode);
  const costPriceIncVat = toIncVat(params.costPrice, params.vatPercent, params.costPriceVatMode);
  const tb1Amount = roundMoney(sellingPriceExVat - costPriceExVat);
  const tb1Percent = sellingPriceExVat === 0 ? null : roundMoney((tb1Amount / sellingPriceExVat) * 100);

  return {
    sellingPriceExVat,
    sellingPriceIncVat,
    costPriceExVat,
    costPriceIncVat,
    tb1Amount,
    tb1Percent
  };
}

export function calculateMinAllowedPrice(params: {
  costPrice: number;
  costPriceVatMode: VatMode;
  salesPriceVatMode: VatMode;
  vatPercent: number;
  minMarginPercent: number;
}): MinAllowedPriceCalculation {
  const costPriceExVat = toExVat(params.costPrice, params.vatPercent, params.costPriceVatMode);
  const minAllowedPriceExVat = roundMoney(costPriceExVat / (1 - params.minMarginPercent / 100));

  return {
    minAllowedPrice: fromExVat(minAllowedPriceExVat, params.vatPercent, params.salesPriceVatMode),
    minAllowedPriceExVat,
    minAllowedPriceIncVat: roundMoney(minAllowedPriceExVat * vatFactor(params.vatPercent))
  };
}

function vatFactor(vatPercent: number): number {
  return 1 + vatPercent / 100;
}
