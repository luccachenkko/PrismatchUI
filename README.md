# Shopify Price Match Batch MVP

MVP för prismatchning med flera Shopify-produkter och flera konkurrentlänkar per produkt.

## Körning

1. Kopiera `.env.example` till `.env` och fyll i Shopify-uppgifter.
2. Fyll i `input/prismatchning.xlsx`.
3. Kör rapport:

```bat
npm install
npm run check-prices
```

Det skapar:

```text
output/prisrapport.xlsx
output/report.json
```

4. Granska fliken `Rekommendationer` i `output/prisrapport.xlsx`.
5. Skriv `ja` i kolumnen `godkand` på rader du vill uppdatera.
6. Kör:

```bat
npm run apply-approved
```

## Viktig logik

- Konkurrentens lagerstatus ignoreras helt.
- Endast pris hämtas från konkurrenter.
- Din egen Shopify-lagerstatus kontrolleras först.
- Om din Shopify-variant har lager `<= 0`, skippas alla konkurrentlänkar för den produkten.
- Shopify-pris hämtas direkt från Shopify, inte från Excel.
