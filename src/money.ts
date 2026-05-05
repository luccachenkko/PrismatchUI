export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\-\s]/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/\s/g, "");
  const decimalNormalized =
    compact.includes(",") && compact.includes(".")
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(",", ".");

  const parsed = Number.parseFloat(decimalNormalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatSEK(value: number | null | undefined): string {
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
