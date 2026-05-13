import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, fmtDate, fmtPrice, STATUS_LABELS } from "@/lib/api";
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
import { toast } from "sonner";
import { CheckCheck, Eraser, Upload, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/reports/$runId")({
  head: () => ({ meta: [{ title: "Rapport · Pricematch Control" }] }),
  component: ReportView,
});

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

function ReportView() {
  const { runId } = useParams({ from: "/reports/$runId" });
  const id = Number(runId);
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
    return list.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (approvalFilter === "approved" && !r.approved) return false;
      if (approvalFilter === "not_approved" && r.approved) return false;
      if (approvalFilter === "updated" && r.shopify_update_status !== "success") return false;
      if (approvalFilter === "shopify_failed" && r.shopify_update_status !== "error") return false;
      if (ql) {
        return (
          r.title.toLowerCase().includes(ql) ||
          (r.sku ?? "").toLowerCase().includes(ql) ||
          (r.cheapest_competitor_domain ?? "").toLowerCase().includes(ql) ||
          (r.cheapest_competitor_url ?? "").toLowerCase().includes(ql)
        );
      }
      return true;
    });
  }, [data, q, statusFilter, approvalFilter]);

  const counts = useMemo(() => {
    const list = data?.recommendations ?? [];
    return {
      ok: list.filter((r) => r.status === "OK").length,
      approved: list.filter((r) => r.approved).length,
      updated: list.filter((r) => r.shopify_update_status === "success").length,
      failed: list.filter((r) => r.shopify_update_status === "error").length,
    };
  }, [data]);

  const selected = recs.find((r) => r.id === selectedRecId) ?? null;

  const approveAll = useMutation({
    mutationFn: () => api.approveAllOk(id),
    onSuccess: (r) => {
      toast.success(`Godkände ${r.approved_count} OK-rader`);
      qc.invalidateQueries({ queryKey: ["run", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const clearAll = useMutation({
    mutationFn: () => api.clearApprovals(id),
    onSuccess: (r) => {
      toast.success(`Avmarkerade ${r.cleared_count} rader`);
      qc.invalidateQueries({ queryKey: ["run", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const apply = useMutation({
    mutationFn: () => api.applyApproved(id),
    onSuccess: (r) => {
      toast.success(`Shopify uppdaterad — ${r.success_count} OK, ${r.error_count} fel`);
      qc.invalidateQueries({ queryKey: ["run", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setApproval = useMutation({
    mutationFn: ({ rec, approved }: { rec: Recommendation; approved: boolean }) =>
      api.setApproval(rec.id, approved),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const onApply = () => {
    if (counts.approved === 0) {
      toast.error("Inga rader är godkända.");
      return;
    }
    if (
      window.confirm(
        `Bekräfta: uppdatera ${counts.approved} godkända priser i Shopify? Detta går inte att ångra.`
      )
    ) {
      apply.mutate();
    }
  };

  return (
    <Workspace
      title={`Rapport #${id}`}
      subtitle={
        data
          ? `${data.recommendations.length} rekommendationer · ${data.shopifyUpdates.length} Shopify-uppdateringar`
          : "Laddar…"
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
            placeholder="Sök SKU, namn, domän, URL…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
            {STATUS_FILTERS.map((s) => (
              <FilterPill
                key={s}
                label={STATUS_LABELS[s] ?? s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              />
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <FilterPill
              label={`Godkända (${counts.approved})`}
              active={approvalFilter === "approved"}
              onClick={() =>
                setApprovalFilter(approvalFilter === "approved" ? "all" : "approved")
              }
            />
            <FilterPill
              label="Ej godkända"
              active={approvalFilter === "not_approved"}
              onClick={() =>
                setApprovalFilter(approvalFilter === "not_approved" ? "all" : "not_approved")
              }
            />
            <FilterPill
              label={`Uppdaterade (${counts.updated})`}
              active={approvalFilter === "updated"}
              onClick={() =>
                setApprovalFilter(approvalFilter === "updated" ? "all" : "updated")
              }
            />
            <FilterPill
              label={`Shopify-fel (${counts.failed})`}
              active={approvalFilter === "shopify_failed"}
              onClick={() =>
                setApprovalFilter(approvalFilter === "shopify_failed" ? "all" : "shopify_failed")
              }
            />
          </div>
        </>
      }
      main={
        <div className="min-h-full">
          {error && <ErrorState error={error} />}
          {isLoading ? (
            <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar rapport…</div>
          ) : recs.length === 0 ? (
            <EmptyState title="Inga rader matchar" hint="Justera filter eller sökning." />
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[10px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="border-b border-border px-2 py-2"></th>
                  <th className="border-b border-border px-2 py-2">SKU</th>
                  <th className="border-b border-border px-2 py-2">Produkt</th>
                  <th className="border-b border-border px-2 py-2 text-right">Pris nu</th>
                  <th className="border-b border-border px-2 py-2 text-right">Lager</th>
                  <th className="border-b border-border px-2 py-2">Billigaste</th>
                  <th className="border-b border-border px-2 py-2 text-right">Konk-pris</th>
                  <th className="border-b border-border px-2 py-2 text-right">Förslag</th>
                  <th className="border-b border-border px-2 py-2 text-right">Inköp</th>
                  <th className="border-b border-border px-2 py-2 text-right">Marg %</th>
                  <th className="border-b border-border px-2 py-2 text-right">Min pris</th>
                  <th className="border-b border-border px-2 py-2">Status</th>
                  <th className="border-b border-border px-2 py-2">Shopify</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((r) => {
                  const isSel = selectedRecId === r.id;
                  const canApprove = r.status === "OK";
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRecId(r.id)}
                      className={`cursor-pointer border-b border-border hover:bg-muted ${
                        isSel ? "bg-info-bg/40" : ""
                      }`}
                    >
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={!!r.approved}
                          disabled={!canApprove}
                          onChange={(e) =>
                            setApproval.mutate({ rec: r, approved: e.target.checked })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {r.sku ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="line-clamp-1">{r.title}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {fmtPrice(r.shopify_price_before)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {r.inventory_quantity ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        {r.cheapest_competitor_domain ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {fmtPrice(r.cheapest_competitor_price)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">
                        {fmtPrice(r.suggested_price)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {fmtPrice(r.cost_price)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {r.margin_after_percent === null
                          ? "—"
                          : `${r.margin_after_percent.toFixed(1)}%`}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {fmtPrice(r.min_allowed_price)}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-2 py-1.5">
                        {r.shopify_update_status === "success" ? (
                          <Tone tone="ok">uppdaterad</Tone>
                        ) : r.shopify_update_status === "error" ? (
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
            Markera en rad för att se alla konkurrentpriser, marginalberäkning och Shopify-logg.
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

function RecommendationContext({ rec, data }: { rec: Recommendation; data: RunReport }) {
  const productSnaps = data.snapshots.filter((s) => s.product_id === rec.product_id);
  const validPrices = productSnaps
    .filter((s) => s.price !== null && s.status === "ok")
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const cheapest = validPrices[0]?.price ?? null;
  const updates = data.shopifyUpdates.filter((u) => u.recommendation_id === rec.id);

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
        <KV k="Pris nu" v={fmtPrice(rec.shopify_price_before)} mono />
        <KV k="Eget lager" v={rec.inventory_quantity ?? "—"} mono />
        <KV k="Shopify synkad" v={fmtDate(rec.last_synced_at)} />
        <KV
          k="Föreslaget pris"
          v={<span className="font-semibold">{fmtPrice(rec.suggested_price)}</span>}
          mono
        />
        <KV k="Inköpspris" v={fmtPrice(rec.cost_price)} mono />
        <KV
          k="Marginal efter"
          v={rec.margin_after_percent === null ? "—" : `${rec.margin_after_percent.toFixed(1)}%`}
          mono
        />
        <KV k="Minsta tillåtna pris" v={fmtPrice(rec.min_allowed_price)} mono />
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
            {productSnaps.map((s) => {
              const isCheapest = s.status === "ok" && s.price !== null && s.price === cheapest;
              const isIgnored = s.status !== "ok" || s.price === null;
              return (
                <li
                  key={s.id}
                  className={`rounded-sm border px-2 py-1.5 text-[11px] ${
                    isCheapest
                      ? "border-ok/40 bg-ok-bg"
                      : isIgnored
                        ? "border-border bg-surface-2 opacity-70"
                        : "border-border bg-surface"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{s.domain}</span>
                    <span className="font-mono">{fmtPrice(s.price)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-1 inline-flex items-center gap-1 hover:underline"
                    >
                      {s.url} <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span>
                      {isCheapest ? (
                        <Tone tone="ok">valt</Tone>
                      ) : s.status === "ok" ? (
                        <Tone>ignorerat</Tone>
                      ) : (
                        <Tone tone="err">{s.status}</Tone>
                      )}
                    </span>
                  </div>
                  {s.error && <div className="mt-0.5 text-err">{s.error}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {updates.length > 0 && (
        <Section title="Shopify-uppdateringar">
          {updates.map((u) => (
            <div
              key={u.id}
              className={`mb-1.5 rounded-sm border px-2 py-1.5 text-[11px] ${
                u.status === "success"
                  ? "border-ok/40 bg-ok-bg text-ok"
                  : "border-err/40 bg-err-bg text-err"
              }`}
            >
              <div className="flex items-center justify-between font-mono">
                <span>{u.status}</span>
                <span>
                  {fmtPrice(u.old_price)} → {fmtPrice(u.new_price)}
                </span>
              </div>
              <div className="mt-0.5 text-muted-foreground">{fmtDate(u.updated_at)}</div>
              {u.error && <div className="mt-0.5">{u.error}</div>}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
