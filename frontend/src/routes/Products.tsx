import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate, fmtPrice } from "@/lib/api";
import {
  Btn,
  EmptyState,
  ErrorState,
  Field,
  KV,
  Section,
  TextInput,
  Workspace,
} from "@/components/pm/Workspace";
import { Tone } from "@/components/pm/StatusPill";
import type { CompetitorLink, PricingRule, Product, VatMode } from "@/lib/types";

const FILTERS = [
  { key: "all", label: "Alla" },
  { key: "in_stock", label: "Har lager" },
  { key: "missing_cost", label: "Saknar inköpspris" },
  { key: "missing_links", label: "Saknar länkar" },
  { key: "has_rules", label: "Har regler" },
  { key: "missing_rules", label: "Saknar regler" },
];

function applyFilter(product: Product, key: string): boolean {
  switch (key) {
    case "in_stock":
      return product.inventory_quantity > 0;
    case "missing_cost":
      return product.cost_price === null;
    case "missing_links":
      return product.competitor_link_count === 0;
    case "has_rules":
      return product.cost_price !== null && product.min_margin_percent !== null;
    case "missing_rules":
      return product.cost_price === null || product.min_margin_percent === null;
    default:
      return true;
  }
}

export function ProductsRoute() {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: api.products,
  });

  const products = useMemo(() => {
    const all = data?.products ?? [];
    const ql = q.trim().toLowerCase();
    return all.filter(
      (product) =>
        applyFilter(product, filter) &&
        (!ql ||
          product.title.toLowerCase().includes(ql) ||
          (product.sku ?? "").toLowerCase().includes(ql) ||
          (product.vendor ?? "").toLowerCase().includes(ql))
    );
  }, [data, filter, q]);

  const selected = products.find((product) => product.id === selectedId) ?? products[0] ?? null;

  return (
    <Workspace
      title="Produkter"
      subtitle={data ? `${products.length} av ${data.products.length} produkter` : "Laddar..."}
      toolbar={
        <>
          <TextInput
            placeholder="Sök SKU, namn, vendor..."
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="max-w-xs"
          />
          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`rounded-sm px-2 py-1 text-[11px] font-medium ${
                  filter === item.key
                    ? "bg-foreground text-background"
                    : "border border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      }
      main={
        <div className="min-h-full">
          {error && <ErrorState error={error} />}
          {isLoading ? (
            <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar produkter...</div>
          ) : (data?.products.length ?? 0) === 0 ? (
            <EmptyState
              title="Inga produkter synkade ännu"
              hint="Synka produkter från Shopify via Dashboard."
            />
          ) : products.length === 0 ? (
            <EmptyState title="Inga produkter matchar" hint="Justera filter eller sökning." />
          ) : (
            <table className="data-table">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-wider text-subtle">
                  <th className="border-b border-border px-3 py-2 font-semibold">SKU</th>
                  <th className="border-b border-border px-3 py-2 font-semibold">Produkt</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Pris</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Lager</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Inköp</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Min TB1 %</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Länkar</th>
                  <th className="border-b border-border px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const isSelected = selected?.id === product.id;
                  return (
                    <tr
                      key={product.id}
                      onClick={() => setSelectedId(product.id)}
                      className={`cursor-pointer ${isSelected ? "is-selected" : ""}`}
                    >
                      <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {product.sku ?? "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="line-clamp-1 font-medium">{product.title}</div>
                        {product.vendor && (
                          <div className="text-[11px] text-muted-foreground">{product.vendor}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(product.shopify_price)}</td>
                      <td
                        className={`px-3 py-1.5 text-right font-mono ${
                          product.inventory_quantity <= 0 ? "text-err" : ""
                        }`}
                      >
                        {product.inventory_quantity}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {product.cost_price === null ? (
                          <span className="text-warn">—</span>
                        ) : (
                          `${fmtPrice(product.cost_price)} ${shortVatMode(product.cost_price_vat_mode ?? "ex_vat")}`
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {product.min_margin_percent === null ? (
                          <span className="text-warn">—</span>
                        ) : (
                          `${product.min_margin_percent}%`
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {product.competitor_link_count === 0 ? (
                          <span className="text-warn">0</span>
                        ) : (
                          product.competitor_link_count
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {product.cost_price === null || product.min_margin_percent === null ? (
                          <Tone tone="warn">behöver regler</Tone>
                        ) : product.competitor_link_count === 0 ? (
                          <Tone tone="warn">inga länkar</Tone>
                        ) : (
                          <Tone tone="ok">redo</Tone>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      }
      contextTitle={selected ? "Produktdetalj" : "Välj produkt"}
      context={selected ? <ProductContext productId={selected.id} /> : <NoSelection />}
    />
  );
}

function NoSelection() {
  return (
    <div className="px-5 py-8 text-[12px] text-muted-foreground">
      Klicka på en produkt i listan för att se Shopify-data, regler och konkurrentlänkar.
    </div>
  );
}

function ProductContext({ productId }: { productId: number }) {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => api.product(productId),
  });

  if (isLoading) return <div className="px-5 py-4 text-[12px] text-muted-foreground">Laddar...</div>;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  const { product, pricingRule, competitorLinks } = data;

  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <div className="text-[13px] font-semibold leading-tight">{product.title}</div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{product.sku ?? "—"}</div>
      </div>

      <Section title="Shopify-data">
        <KV k="Product ID" v={<span className="font-mono">{product.shopify_product_id}</span>} />
        <KV k="Variant ID" v={<span className="font-mono">{product.shopify_variant_id}</span>} />
        <KV k="Shopify-pris" v={fmtPrice(product.shopify_price)} mono />
        <KV k="Eget lager" v={product.inventory_quantity} mono />
        <KV k="Vendor" v={product.vendor ?? "—"} />
        <KV k="Product type" v={product.product_type ?? "—"} />
        <KV k="Barcode" v={product.barcode ?? "—"} mono />
        <KV k="Senast synkad" v={fmtDate(product.last_synced_at)} />
      </Section>

      <Section title="Prismatchningsregel">
        <PricingRuleForm
          key={product.id}
          productId={product.id}
          rule={pricingRule}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["product", productId] });
            qc.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      </Section>

      <Section title={`Konkurrentlänkar (${competitorLinks.length})`}>
        <CompetitorLinks
          productId={product.id}
          links={competitorLinks}
          onChange={() => {
            qc.invalidateQueries({ queryKey: ["product", productId] });
            qc.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      </Section>
    </div>
  );
}

function PricingRuleForm({
  productId,
  rule,
  onSaved,
}: {
  productId: number;
  rule: PricingRule | null;
  onSaved: () => void;
}) {
  const [cost, setCost] = useState(rule?.cost_price?.toString() ?? "");
  const [costVatMode, setCostVatMode] = useState<VatMode>(rule?.cost_price_vat_mode ?? "ex_vat");
  const [salesVatMode, setSalesVatMode] = useState<VatMode>(rule?.sales_price_vat_mode ?? "inc_vat");
  const [vatPercent, setVatPercent] = useState(rule?.vat_percent?.toString() ?? "25");
  const [margin, setMargin] = useState(rule?.min_margin_percent?.toString() ?? "");
  const [undercut, setUndercut] = useState(rule?.undercut_amount?.toString() ?? "");
  const [enabled, setEnabled] = useState(rule ? rule.enabled === 1 : true);

  const save = useMutation({
    mutationFn: () =>
      api.savePricingRule(productId, {
        cost_price: cost === "" ? null : Number(cost),
        cost_price_vat_mode: costVatMode,
        sales_price_vat_mode: salesVatMode,
        vat_percent: vatPercent === "" ? 25 : Number(vatPercent),
        min_margin_percent: margin === "" ? null : Number(margin),
        undercut_amount: undercut === "" ? null : Number(undercut),
        enabled,
      }),
    onSuccess: () => {
      toast.success("Regel sparad");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-2">
      <Field label={`Inköpspris (${costVatMode === "ex_vat" ? "ex moms" : "inkl moms"})`}>
        <TextInput
          mono
          inputMode="decimal"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
      </Field>
      <Field label="Inköpspriset är">
        <Select value={costVatMode} onChange={(value) => setCostVatMode(value as VatMode)}>
          <option value="ex_vat">Ex moms</option>
          <option value="inc_vat">Inkl moms</option>
        </Select>
      </Field>
      <Field label="Försäljningspriser är">
        <Select value={salesVatMode} onChange={(value) => setSalesVatMode(value as VatMode)}>
          <option value="inc_vat">Inkl moms</option>
          <option value="ex_vat">Ex moms</option>
        </Select>
      </Field>
      <Field label="Moms %">
        <TextInput
          mono
          inputMode="decimal"
          value={vatPercent}
          onChange={(event) => setVatPercent(event.target.value)}
        />
      </Field>
      <Field label="Min TB1 (%)">
        <TextInput
          mono
          inputMode="decimal"
          value={margin}
          onChange={(event) => setMargin(event.target.value)}
        />
      </Field>
      <Field label="Undercut (kr)">
        <TextInput
          mono
          inputMode="decimal"
          value={undercut}
          onChange={(event) => setUndercut(event.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 pt-1 text-[12px]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Regel aktiv
      </label>
      <div className="pt-2">
        <Btn variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Sparar..." : "Spara regel"}
        </Btn>
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="block w-full rounded-sm border border-border bg-surface px-2 py-1.5 text-[12px] text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {children}
    </select>
  );
}

function shortVatMode(mode: VatMode): string {
  return mode === "inc_vat" ? "inkl" : "ex";
}

function CompetitorLinks({
  productId,
  links,
  onChange,
}: {
  productId: number;
  links: CompetitorLink[];
  onChange: () => void;
}) {
  const [newUrl, setNewUrl] = useState("");

  const create = useMutation({
    mutationFn: () => api.createLink(productId, { url: newUrl, enabled: true }),
    onSuccess: () => {
      setNewUrl("");
      toast.success("Länk tillagd");
      onChange();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: (link: CompetitorLink) =>
      api.updateLink(link.id, { url: link.url, enabled: link.enabled !== 1 }),
    onSuccess: () => onChange(),
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLink(id),
    onSuccess: () => {
      toast.success("Länk borttagen");
      onChange();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <TextInput
          type="url"
          placeholder="https://konkurrent.se/produkt"
          value={newUrl}
          onChange={(event) => setNewUrl(event.target.value)}
        />
        <Btn onClick={() => create.mutate()} disabled={!newUrl.trim() || create.isPending}>
          <Plus className="h-3 w-3" />
          Lägg till
        </Btn>
      </div>

      {links.length === 0 ? (
        <div className="mt-3 text-[12px] text-muted-foreground">Inga konkurrentlänkar.</div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {links.map((link) => (
            <li key={link.id} className="rounded-sm border border-border bg-surface-2 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{link.domain}</span>
                    {link.scraper_supported ? (
                      <Tone tone="ok">scraper</Tone>
                    ) : (
                      <Tone tone="warn">ingen scraper</Tone>
                    )}
                    {link.enabled !== 1 && <Tone>inaktiv</Tone>}
                  </div>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 line-clamp-1 inline-flex items-center gap-1 text-[11px] text-info hover:underline"
                  >
                    {link.url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="font-mono">{fmtPrice(link.last_price)}</span>
                    <span>{fmtDate(link.last_checked_at)}</span>
                  </div>
                  {link.last_error && (
                    <div className="mt-1 text-[11px] text-err">{link.last_error}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Btn size="xs" onClick={() => toggle.mutate(link)}>
                    {link.enabled === 1 ? "Inaktivera" : "Aktivera"}
                  </Btn>
                  <Btn size="xs" variant="danger" onClick={() => remove.mutate(link.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Btn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
