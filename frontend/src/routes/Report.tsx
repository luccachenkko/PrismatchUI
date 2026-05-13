import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CheckCheck, Eraser, ExternalLink, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate, fmtPercent, fmtPrice, STATUS_LABELS } from "@/lib/api";
import {
  Btn,
  EmptyState,
  ErrorState,
  KV,
  Section,
  TextInput,
  Workspace,
} from "@/components/pm/Workspace";
import { StatusPill, Tone } from "@/components/pm/StatusPill";
import type { Recommendation, RunReport } from "@/lib/types";

const STATUS_FILTERS = [
  "OK",
  "INGEN_ANDRING",
  "SKIPPAD_EGET_LAGER_0",
  "SAKNAR_INKOPSPRIS",
  "SAKNAR_MIN_MARGINAL",
  "SAKNAR_LANKAR",
  "INGET_PRIS",
  "BLOCKERAD_MARGINAL",
  "SHOPIFY_FEL",
];

type ApprovalFilter = "all" | "approved" | "not_approved" | "updated" | "shopify_failed";

const STATUS_ORDER = new Map<string, number>([
  ["OK", 0],
  ["BLOCKERAD_MARGINAL", 1],
  ["SAKNAR_INKOPSPRIS", 2],
  ["SAKNAR_MIN_MARGINAL", 3],
  ["SAKNAR_LANKAR", 4],
  ["INGET_PRIS", 5],
  ["INGEN_ANDRING", 6],
  ["SKIPPAD_EGET_LAGER_0", 7],
  ["SHOPIFY_FEL", 8],
]);

export function ReportRoute() {
  const params = useParams({ from: "/reports/$runId" });
  const id = Number(params.runId);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("all");
  const [selectedRecId, setSelectedRecId] = useState<number | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.run(id),
  });

  const recs = useMemo(() => {
    const list = data?.recommendations ?? [];
    const ql = q.trim().toLowerCase();
    return list
      .filter((rec) => {
        if (statusFilter && rec.status !== statusFilter) return false;
        if (approvalFilter === "approved" && rec.approved !== 1) return false;
        if (approvalFilter === "not_approved" && rec.approved === 1) return false;
        if (approvalFilter === "updated" && !isSuccessfulUpdate(rec.shopify_update_status)) return false;
        if (approvalFilter === "shopify_failed" && rec.shopify_update_status !== "failed") return false;
        if (ql) {
          const productSnaps = data?.snapshots.filter((snap) => snap.product_id === rec.product_id) ?? [];
          return (
            rec.title.toLowerCase().includes(ql) ||
            (rec.sku ?? "").toLowerCase().includes(ql) ||
            (rec.cheapest_competitor_domain ?? "").toLowerCase().includes(ql) ||
            (rec.cheapest_competitor_url ?? "").toLowerCase().includes(ql) ||
            productSnaps.some(
              (snap) =>
                snap.domain.toLowerCase().includes(ql) ||
                snap.url.toLowerCase().includes(ql)
            )
          );
        }
        return true;
      })
      .sort(compareQueue);
  }, [approvalFilter, data, q, statusFilter]);

  const counts = useMemo(() => {
    const list = data?.recommendations ?? [];
    return {
      ok: list.filter((rec) => rec.status === "OK").length,
      approved: list.filter((rec) => rec.approved === 1).length,
      updated: list.filter((rec) => isSuccessfulUpdate(rec.shopify_update_status)).length,
      failed: list.filter((rec) => rec.shopify_update_status === "failed").length,
    };
  }, [data]);

  const selected = recs.find((rec) => rec.id === selectedRecId) ?? recs[0] ?? null;

  const approveAll = useMutation({
    mutationFn: () => api.approveAllOk(id),
    onSuccess: (result) => {
      toast.success(`Godkände ${result.approved_count} OK-rader`);
      qc.invalidateQueries({ queryKey: ["run", id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const clearAll = useMutation({
    mutationFn: () => api.clearApprovals(id),
    onSuccess: (result) => {
      toast.success(`Avmarkerade ${result.cleared_count} rader`);
      qc.invalidateQueries({ queryKey: ["run", id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const apply = useMutation({
    mutationFn: () => api.applyApproved(id),
    onSuccess: (result) => {
      toast.success(`Shopify uppdaterad: ${result.success_count} OK, ${result.error_count} fel`);
      qc.invalidateQueries({ queryKey: ["run", id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setApproval = useMutation({
    mutationFn: ({ rec, approved }: { rec: Recommendation; approved: boolean }) =>
      api.setApproval(rec.id, approved),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run", id] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const onApply = () => {
    if (counts.approved === 0) {
      toast.error("Inga rader är godkända.");
      return;
    }
    if (window.confirm("Är du säker? Detta uppdaterar godkända priser i Shopify.")) {
      apply.mutate();
    }
  };

  return (
    <Workspace
      title={`Rapport #${id}`}
      subtitle={
        data
          ? `${data.recommendations.length} rekommendationer · ${data.shopifyUpdates.length} Shopify-uppdateringar`
          : "Laddar..."
      }
      actions={
        <>
          <Btn variant="ok" onClick={() => approveAll.mutate()} disabled={approveAll.isPending}>
            <CheckCheck className="h-3.5 w-3.5" />
            Godkänn alla OK ({counts.ok})
          </Btn>
          <Btn onClick={() => clearAll.mutate()} disabled={clearAll.isPending}>
            <Eraser className="h-3.5 w-3.5" />
            Avmarkera alla
          </Btn>
          <Btn variant="primary" onClick={onApply} disabled={apply.isPending || counts.approved === 0}>
            <Upload className="h-3.5 w-3.5" />
            Uppdatera {counts.approved} i Shopify
          </Btn>
        </>
      }
      toolbar={
        <>
          <TextInput
            placeholder="Sök SKU, namn, domän, URL..."
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="max-w-xs"
          />
          <div className="flex flex-wrap items-center gap-1">
            <FilterPill
              label="Alla"
              active={!statusFilter && approvalFilter === "all"}
              onClick={() => {
                setStatusFilter(null);
                setApprovalFilter("all");
              }}
            />
            {STATUS_FILTERS.map((status) => (
              <FilterPill
                key={status}
                label={STATUS_LABELS[status] ?? status}
                active={statusFilter === status}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              />
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <FilterPill
              label={`Godkända (${counts.approved})`}
              active={approvalFilter === "approved"}
              onClick={() => setApprovalFilter(approvalFilter === "approved" ? "all" : "approved")}
            />
            <FilterPill
              label="Ej godkända"
              active={approvalFilter === "not_approved"}
              onClick={() => setApprovalFilter(approvalFilter === "not_approved" ? "all" : "not_approved")}
            />
            <FilterPill
              label={`Uppdaterade (${counts.updated})`}
              active={approvalFilter === "updated"}
              onClick={() => setApprovalFilter(approvalFilter === "updated" ? "all" : "updated")}
            />
            <FilterPill
              label={`Shopify-fel (${counts.failed})`}
              active={approvalFilter === "shopify_failed"}
              onClick={() => setApprovalFilter(approvalFilter === "shopify_failed" ? "all" : "shopify_failed")}
            />
          </div>
        </>
      }
      main={
        <div className="min-h-full">
          {error && <ErrorState error={error} />}
          {isLoading ? (
            <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar rapport...</div>
          ) : (data?.recommendations.length ?? 0) === 0 ? (
            <EmptyState title="Inga rekommendationer finns för denna körning." />
          ) : recs.length === 0 ? (
            <EmptyState title="Inga rader matchar" hint="Justera filter eller sökning." />
          ) : (
            <table className="data-table">
              <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[10px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="border-b border-border px-2 py-2"></th>
                  <th className="border-b border-border px-2 py-2">SKU</th>
                  <th className="border-b border-border px-2 py-2">Produkt</th>
                  <th className="border-b border-border px-2 py-2 text-right">Shopify-pris inkl/ex</th>
                  <th className="border-b border-border px-2 py-2">Billigaste</th>
                  <th className="border-b border-border px-2 py-2 text-right">Konkurrentpris inkl/ex</th>
                  <th className="border-b border-border px-2 py-2 text-right">Föreslaget inkl/ex</th>
                  <th className="border-b border-border px-2 py-2 text-right">Inköpspris inkl/ex</th>
                  <th className="border-b border-border px-2 py-2 text-right">Minsta pris inkl/ex</th>
                  <th className="border-b border-border px-2 py-2 text-right">Moms %</th>
                  <th className="border-b border-border px-2 py-2 text-right">TB1 kr</th>
                  <th className="border-b border-border px-2 py-2 text-right">TB1 %</th>
                  <th className="border-b border-border px-2 py-2">Status</th>
                  <th className="border-b border-border px-2 py-2">Orsak</th>
                  <th className="border-b border-border px-2 py-2">Shopify</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((rec) => {
                  const isSelected = selected?.id === rec.id;
                  const canApprove = rec.status === "OK";
                  return (
                    <tr
                      key={rec.id}
                      onClick={() => setSelectedRecId(rec.id)}
                      className={`cursor-pointer ${isSelected ? "is-selected" : ""}`}
                    >
                      <td className="px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={rec.approved === 1}
                          disabled={!canApprove}
                          onChange={(event) =>
                            setApproval.mutate({ rec, approved: event.target.checked })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {rec.sku ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="line-clamp-1">{rec.title}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          Lager {rec.inventory_quantity ?? "—"}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        <PricePair inc={rec.shopify_price_inc_vat} ex={rec.shopify_price_ex_vat} />
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        {rec.cheapest_competitor_domain ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        <PricePair inc={rec.cheapest_competitor_price_inc_vat} ex={rec.cheapest_competitor_price_ex_vat} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">
                        <PricePair inc={rec.suggested_price_inc_vat} ex={rec.suggested_price_ex_vat} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        <PricePair inc={rec.cost_price_inc_vat} ex={rec.cost_price_ex_vat} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        <PricePair inc={rec.min_allowed_price_inc_vat} ex={rec.min_allowed_price_ex_vat} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {fmtPercent(rec.vat_percent)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {fmtPrice(rec.tb1_amount)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {fmtPercent(rec.tb1_percent)}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusPill status={rec.status} />
                      </td>
                      <td className="max-w-[240px] px-2 py-1.5 text-[11px] text-muted-foreground">
                        <div className="line-clamp-2">{rec.reason}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        {isSuccessfulUpdate(rec.shopify_update_status) ? (
                          <Tone tone="ok">uppdaterad</Tone>
                        ) : rec.shopify_update_status === "failed" ? (
                          <Tone tone="err">fel</Tone>
                        ) : (
                          <span className="text-[11px] text-subtle">—</span>
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
      contextTitle={selected ? "Beslutsunderlag" : "Välj rad"}
      context={
        selected && data ? (
          <RecommendationContext rec={selected} data={data} />
        ) : (
          <div className="px-5 py-8 text-[12px] text-muted-foreground">
            Markera en rad för att se alla konkurrentpriser, TB1-beräkning och Shopify-logg.
          </div>
        )
      }
    />
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm px-2 py-1 text-[11px] font-medium ${
        active
          ? "bg-foreground text-background"
          : "border border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function PricePair({ inc, ex }: { inc: number | null | undefined; ex: number | null | undefined }) {
  if (inc == null && ex == null) {
    return <span className="text-subtle">—</span>;
  }

  return (
    <span>
      <span>{fmtPrice(inc)} inkl</span>
      <span className="text-subtle"> / </span>
      <span>{fmtPrice(ex)} ex</span>
    </span>
  );
}

function RecommendationContext({ rec, data }: { rec: Recommendation; data: RunReport }) {
  const productSnaps = data.snapshots.filter((snap) => snap.product_id === rec.product_id);
  const validPrices = productSnaps
    .filter((snap) => snap.price !== null && snap.status === "success")
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const cheapest = validPrices[0]?.price ?? null;
  const updates = data.shopifyUpdates.filter(
    (update) => update.recommendation_id === rec.id || update.product_id === rec.product_id
  );

  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[11px] text-muted-foreground">{rec.sku ?? "—"}</div>
          <StatusPill status={rec.status} />
        </div>
        <div className="mt-0.5 text-[13px] font-semibold leading-tight">{rec.title}</div>
      </div>

      <Section title="Beslut">
        <KV k="Shopify-pris inkl moms" v={fmtPrice(rec.shopify_price_inc_vat)} mono />
        <KV k="Shopify-pris ex moms" v={fmtPrice(rec.shopify_price_ex_vat)} mono />
        <KV k="Eget lager" v={rec.inventory_quantity ?? "—"} mono />
        <KV k="Shopify synkad" v={fmtDate(rec.last_synced_at)} />
        <KV k="Konkurrentpris inkl moms" v={fmtPrice(rec.cheapest_competitor_price_inc_vat)} mono />
        <KV k="Konkurrentpris ex moms" v={fmtPrice(rec.cheapest_competitor_price_ex_vat)} mono />
        <KV k="Undercut" v={fmtPrice(undercutAmount(rec))} mono />
        <KV k="Föreslaget pris inkl moms" v={<span className="font-semibold">{fmtPrice(rec.suggested_price_inc_vat)}</span>} mono />
        <KV k="Föreslaget pris ex moms" v={fmtPrice(rec.suggested_price_ex_vat)} mono />
        <KV k="Inköpspris inkl moms" v={fmtPrice(rec.cost_price_inc_vat)} mono />
        <KV k="Inköpspris ex moms" v={fmtPrice(rec.cost_price_ex_vat)} mono />
        <KV k="Minsta pris inkl moms" v={fmtPrice(rec.min_allowed_price_inc_vat)} mono />
        <KV k="Minsta pris ex moms" v={fmtPrice(rec.min_allowed_price_ex_vat)} mono />
        <KV k="TB1 kr" v={fmtPrice(rec.tb1_amount)} mono />
        <KV k="TB1 %" v={fmtPercent(rec.tb1_percent)} mono />
        <KV k="Moms %" v={fmtPercent(rec.vat_percent)} mono />
        {rec.reason && (
          <div className="mt-2 rounded-sm bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
            {rec.reason}
          </div>
        )}
      </Section>

      <Section title={`Konkurrentpriser (${productSnaps.length})`}>
        {productSnaps.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">Inga snapshots.</div>
        ) : (
          <ul className="space-y-1">
            {productSnaps.map((snap) => {
              const isCheapest = snap.status === "success" && snap.price !== null && snap.price === cheapest;
              const isIgnored = snap.status !== "success" || snap.price === null;
              const snapPair = salesModePricePair(snap.price, rec.vat_percent, rec.sales_price_vat_mode);
              return (
                <li
                  key={snap.id}
                  className={`rounded-sm border px-2 py-1.5 text-[11px] ${
                    isCheapest
                      ? "border-ok/40 bg-ok-bg"
                      : isIgnored
                        ? "border-border bg-surface-2 opacity-70"
                        : "border-border bg-surface"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{snap.domain}</span>
                    <span className="font-mono">
                      <PricePair inc={snapPair.inc} ex={snapPair.ex} />
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                    <a
                      href={snap.url}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-1 inline-flex items-center gap-1 hover:underline"
                    >
                      {snap.url} <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span>
                      {isCheapest ? (
                        <Tone tone="ok">valt</Tone>
                      ) : snap.status === "success" ? (
                        <Tone>ignorerat</Tone>
                      ) : (
                        <Tone tone="err">{snap.status}</Tone>
                      )}
                    </span>
                  </div>
                  {snap.error && <div className="mt-0.5 text-err">{snap.error}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {updates.length > 0 && (
        <Section title="Shopify-uppdateringar">
          {updates.map((update) => (
            <div
              key={update.id}
              className={`mb-1.5 rounded-sm border px-2 py-1.5 text-[11px] ${
                isSuccessfulUpdate(update.status)
                  ? "border-ok/40 bg-ok-bg text-ok"
                  : "border-err/40 bg-err-bg text-err"
              }`}
            >
              <div className="flex items-center justify-between font-mono">
                <span>{update.status}</span>
                <span>
                  {fmtPrice(update.old_price)} → {fmtPrice(update.new_price)}
                </span>
              </div>
              <div className="mt-0.5 text-muted-foreground">{fmtDate(update.updated_at)}</div>
              {update.error && <div className="mt-0.5">{update.error}</div>}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function undercutAmount(rec: Recommendation): number | null {
  if (rec.cheapest_competitor_price === null || rec.suggested_price === null) return null;
  return roundMoney(rec.cheapest_competitor_price - rec.suggested_price);
}

function salesModePricePair(
  amount: number | null | undefined,
  vatPercent: number,
  salesPriceVatMode: "inc_vat" | "ex_vat"
): { inc: number | null; ex: number | null } {
  if (amount == null) {
    return { inc: null, ex: null };
  }

  const factor = 1 + vatPercent / 100;
  return salesPriceVatMode === "inc_vat"
    ? { inc: roundMoney(amount), ex: roundMoney(amount / factor) }
    : { inc: roundMoney(amount * factor), ex: roundMoney(amount) };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function compareQueue(a: Recommendation, b: Recommendation): number {
  const statusCmp = (STATUS_ORDER.get(a.status) ?? 99) - (STATUS_ORDER.get(b.status) ?? 99);
  if (statusCmp !== 0) return statusCmp;

  const aChange = absoluteChange(a);
  const bChange = absoluteChange(b);
  if (aChange !== null && bChange !== null && aChange !== bChange) return bChange - aChange;
  if (aChange !== null && bChange === null) return -1;
  if (aChange === null && bChange !== null) return 1;

  return (a.sku ?? "").localeCompare(b.sku ?? "", "sv-SE", { numeric: true });
}

function absoluteChange(rec: Recommendation): number | null {
  if (rec.suggested_price === null || rec.shopify_price_before === null) return null;
  return Math.abs(rec.suggested_price - rec.shopify_price_before);
}

function isSuccessfulUpdate(status: string | null | undefined): boolean {
  return status === "success" || status === "updated";
}
