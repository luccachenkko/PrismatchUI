import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
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
import { toast } from "sonner";
import type { CompetitorLink, Product } from "@/lib/types";
import { ExternalLink, Plus, Trash2 } from "lucide-react";

const searchSchema = z.object({
  filter: z.string().optional(),
  q: z.string().optional(),
  selected: z.coerce.number().optional(),
});

export const Route = createFileRoute("/products")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Produkter · Pricematch Control" }] }),
  component: ProductsView,
});

const FILTERS = [
  { key: "all", label: "Alla" },
  { key: "in_stock", label: "Har lager" },
  { key: "missing_cost", label: "Saknar inköpspris" },
  { key: "missing_links", label: "Saknar länkar" },
  { key: "has_rules", label: "Har regler" },
  { key: "missing_rules", label: "Saknar regler" },
];

function applyFilter(p: Product, key: string): boolean {
  switch (key) {
    case "in_stock":
      return p.inventory_quantity > 0;
    case "missing_cost":
      return p.cost_price === null;
    case "missing_links":
      return p.competitor_link_count === 0;
    case "has_rules":
      return p.cost_price !== null && p.min_margin_percent !== null;
    case "missing_rules":
      return p.cost_price === null || p.min_margin_percent === null;
    default:
      return true;
  }
}

function ProductsView() {
  const search = useSearch({ from: "/products" });
  const navigate = Route.useNavigate();
  const filter = search.filter ?? "all";
  const q = search.q ?? "";
  const selectedId = search.selected ?? null;

  const setSearch = (next: Partial<typeof search>) =>
    navigate({ search: ((prev: any) => ({ ...prev, ...next })) as any });

  const { data, error, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: api.products,
  });

  const products = useMemo(() => {
    const all = data?.products ?? [];
    const ql = q.trim().toLowerCase();
    return all.filter(
      (p) =>
        applyFilter(p, filter) &&
        (!ql ||
          p.title.toLowerCase().includes(ql) ||
          (p.sku ?? "").toLowerCase().includes(ql) ||
          (p.vendor ?? "").toLowerCase().includes(ql))
    );
  }, [data, filter, q]);

  const selected = products.find((p) => p.id === selectedId) ?? null;

  return (
    <Workspace
      title="Produkter"
      subtitle={
        data ? `${products.length} av ${data.products.length} produkter` : "Laddar…"
      }
      toolbar={
        <>
          <TextInput
            placeholder="Sök SKU, namn, vendor…"
            value={q}
            onChange={(e) => setSearch({ q: e.target.value || undefined })}
            className="max-w-xs"
          />
          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setSearch({ filter: f.key === "all" ? undefined : f.key })}
                className={`rounded-sm px-2 py-1 text-[11px] font-medium ${
                  filter === f.key
                    ? "bg-foreground text-background"
                    : "border border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      }
      main={
        <div className="min-h-full">
          {error && <ErrorState error={error} />}
          {isLoading ? (
            <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar produkter…</div>
          ) : products.length === 0 ? (
            <EmptyState title="Inga produkter matchar" hint="Justera filter eller synka från Shopify." />
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface-2">
                <tr className="text-left text-[10px] uppercase tracking-wider text-subtle">
                  <th className="border-b border-border px-3 py-2 font-semibold">SKU</th>
                  <th className="border-b border-border px-3 py-2 font-semibold">Produkt</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Pris</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Lager</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Inköp</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Min%</th>
                  <th className="border-b border-border px-3 py-2 text-right font-semibold">Länkar</th>
                  <th className="border-b border-border px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const isSel = selectedId === p.id;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSearch({ selected: p.id })}
                      className={`cursor-pointer border-b border-border hover:bg-muted ${
                        isSel ? "bg-info-bg/40" : ""
                      }`}
                    >
                      <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {p.sku ?? "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="line-clamp-1 font-medium">{p.title}</div>
                        {p.vendor && (
                          <div className="text-[11px] text-muted-foreground">{p.vendor}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(p.shopify_price)}</td>
                      <td
                        className={`px-3 py-1.5 text-right font-mono ${
                          p.inventory_quantity <= 0 ? "text-err" : ""
                        }`}
                      >
                        {p.inventory_quantity}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {p.cost_price === null ? (
                          <span className="text-warn">—</span>
                        ) : (
                          fmtPrice(p.cost_price)
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {p.min_margin_percent === null ? (
                          <span className="text-warn">—</span>
                        ) : (
                          `${p.min_margin_percent}%`
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {p.competitor_link_count === 0 ? (
                          <span className="text-warn">0</span>
                        ) : (
                          p.competitor_link_count
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {p.cost_price === null || p.min_margin_percent === null ? (
                          <Tone tone="warn">behöver regler</Tone>
                        ) : p.competitor_link_count === 0 ? (
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

  if (isLoading) return <div className="px-5 py-4 text-[12px] text-muted-foreground">Laddar…</div>;
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
        <KV k="Pris" v={fmtPrice(product.shopify_price)} mono />
        <KV k="Eget lager" v={product.inventory_quantity} mono />
        <KV k="Vendor" v={product.vendor ?? "—"} />
        <KV k="Barcode" v={product.barcode ?? "—"} mono />
        <KV k="Senast synkad" v={fmtDate(product.last_synced_at)} />
      </Section>

      <Section title="Prismatchningsregel">
        <PricingRuleForm
          productId={product.id}
          rule={pricingRule}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["product", productId] });
            qc.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      </Section>

      <Section
        title={`Konkurrentlänkar (${competitorLinks.length})`}
        right={null}
      >
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
  rule: { cost_price: number | null; min_margin_percent: number | null; undercut_amount: number | null; enabled: number } | null;
  onSaved: () => void;
}) {
  const [cost, setCost] = useState(rule?.cost_price?.toString() ?? "");
  const [margin, setMargin] = useState(rule?.min_margin_percent?.toString() ?? "");
  const [undercut, setUndercut] = useState(rule?.undercut_amount?.toString() ?? "");
  const [enabled, setEnabled] = useState(rule ? !!rule.enabled : true);

  const save = useMutation({
    mutationFn: () =>
      api.savePricingRule(productId, {
        cost_price: cost === "" ? null : Number(cost),
        min_margin_percent: margin === "" ? null : Number(margin),
        undercut_amount: undercut === "" ? null : Number(undercut),
        enabled,
      }),
    onSuccess: () => {
      toast.success("Regel sparad");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2">
      <Field label="Inköpspris (kr)">
        <TextInput
          mono
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="ex. 199.00"
        />
      </Field>
      <Field label="Min marginal (%)">
        <TextInput
          mono
          inputMode="decimal"
          value={margin}
          onChange={(e) => setMargin(e.target.value)}
          placeholder="ex. 15"
        />
      </Field>
      <Field label="Undercut (kr)">
        <TextInput
          mono
          inputMode="decimal"
          value={undercut}
          onChange={(e) => setUndercut(e.target.value)}
          placeholder="ex. 1"
        />
      </Field>
      <label className="flex items-center gap-2 pt-1 text-[12px]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Regel aktiv
      </label>
      <div className="pt-2">
        <Btn variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Sparar…" : "Spara regel"}
        </Btn>
      </div>
    </div>
  );
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
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (l: CompetitorLink) =>
      api.updateLink(l.id, { url: l.url, enabled: !l.enabled }),
    onSuccess: () => onChange(),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLink(id),
    onSuccess: () => {
      toast.success("Länk borttagen");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <TextInput
          placeholder="https://konkurrent.se/produkt"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
        />
        <Btn
          onClick={() => create.mutate()}
          disabled={!newUrl.trim() || create.isPending}
        >
          <Plus className="h-3 w-3" />
          Lägg till
        </Btn>
      </div>

      {links.length === 0 ? (
        <div className="mt-3 text-[12px] text-muted-foreground">Inga konkurrentlänkar.</div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="rounded-sm border border-border bg-surface-2 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{l.domain}</span>
                    {l.scraper_supported ? (
                      <Tone tone="ok">scraper</Tone>
                    ) : (
                      <Tone tone="warn">ingen scraper</Tone>
                    )}
                    {!l.enabled && <Tone>inaktiv</Tone>}
                  </div>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 line-clamp-1 inline-flex items-center gap-1 text-[11px] text-info hover:underline"
                  >
                    {l.url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="font-mono">{fmtPrice(l.last_price)}</span>
                    <span>{fmtDate(l.last_checked_at)}</span>
                  </div>
                  {l.last_error && (
                    <div className="mt-1 text-[11px] text-err">{l.last_error}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Btn size="xs" onClick={() => toggle.mutate(l)}>
                    {l.enabled ? "Inaktivera" : "Aktivera"}
                  </Btn>
                  <Btn size="xs" variant="danger" onClick={() => remove.mutate(l.id)}>
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
