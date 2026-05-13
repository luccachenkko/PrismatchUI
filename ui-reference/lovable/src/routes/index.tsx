import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate } from "@/lib/api";
import { Btn, EmptyState, ErrorState, Workspace } from "@/components/pm/Workspace";
import { Tone } from "@/components/pm/StatusPill";
import { toast } from "sonner";
import { Play, RefreshCw, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard · Pricematch Control" }] }),
  component: Dashboard,
});

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "ok" | "warn" | "err" | "muted";
  hint?: string;
}) {
  return (
    <div className="border-r border-border px-5 py-3 last:border-r-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-[22px] font-semibold tabular-nums ${
          tone === "ok"
            ? "text-ok"
            : tone === "warn"
              ? "text-warn"
              : tone === "err"
                ? "text-err"
                : "text-foreground"
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: api.products });
  const runs = useQuery({ queryKey: ["runs"], queryFn: api.runs });

  const sync = useMutation({
    mutationFn: api.syncShopify,
    onSuccess: (r) => {
      toast.success(`Synkade ${r.syncedCount} produkter från Shopify`);
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startRun = useMutation({
    mutationFn: api.startRun,
    onSuccess: (r) => {
      toast.success(`Prismatchningskörning #${r.run.id} startad`);
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate({ to: "/reports/$runId", params: { runId: String(r.run.id) } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = products.data?.stats;
  const latestRuns = runs.data?.runs.slice(0, 8) ?? [];
  const latest = latestRuns[0];

  const queue: { key: string; title: string; count: number; to: string; tone: "warn" | "err" | "ok" }[] = [];
  if (stats) {
    if (stats.missingCostPriceCount > 0)
      queue.push({
        key: "cost",
        title: "Produkter saknar inköpspris",
        count: stats.missingCostPriceCount,
        to: "/products?filter=missing_cost",
        tone: "warn",
      });
    if (stats.missingCompetitorLinksCount > 0)
      queue.push({
        key: "links",
        title: "Produkter saknar konkurrentlänkar",
        count: stats.missingCompetitorLinksCount,
        to: "/products?filter=missing_links",
        tone: "warn",
      });
    if (stats.okRecommendationCount > 0 && latest)
      queue.push({
        key: "ok",
        title: "OK-rader att godkänna i senaste rapport",
        count: stats.okRecommendationCount,
        to: `/reports/${latest.id}`,
        tone: "ok",
      });
    if (stats.errorRecommendationCount > 0 && latest)
      queue.push({
        key: "err",
        title: "Fel/blockerade rader i senaste rapport",
        count: stats.errorRecommendationCount + stats.blockedRecommendationCount,
        to: `/reports/${latest.id}`,
        tone: "err",
      });
  }

  return (
    <Workspace
      title="Kontrollcenter"
      subtitle={stats ? `${stats.productCount} produkter · ${stats.inStockCount} i lager` : "Laddar…"}
      actions={
        <>
          <Btn onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
            Synka från Shopify
          </Btn>
          <Btn variant="primary" onClick={() => startRun.mutate()} disabled={startRun.isPending}>
            <Play className="h-3.5 w-3.5" />
            Kör prismatchning
          </Btn>
        </>
      }
      main={
        <div className="flex flex-col">
          {products.error && <ErrorState error={products.error} />}

          <div className="grid grid-cols-2 border-b border-border bg-surface md:grid-cols-4 lg:grid-cols-6">
            <Stat label="Produkter" value={stats?.productCount ?? "—"} />
            <Stat label="I lager" value={stats?.inStockCount ?? "—"} />
            <Stat label="OK-rader" value={stats?.okRecommendationCount ?? "—"} tone="ok" />
            <Stat
              label="Blockerade"
              value={stats?.blockedRecommendationCount ?? "—"}
              tone="warn"
            />
            <Stat label="Shopify-fel" value={stats?.errorRecommendationCount ?? "—"} tone="err" />
            <Stat
              label="Senaste körning"
              value={stats?.latestRun ? fmtDate(stats.latestRun).slice(0, 16) : "—"}
            />
          </div>

          <div className="grid flex-1 grid-cols-1 gap-0 lg:grid-cols-[1fr_360px]">
            <section className="border-b border-border lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between border-b border-border px-5 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  Nästa åtgärder
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {queue.length} öppna
                </div>
              </div>
              {products.isLoading ? (
                <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar…</div>
              ) : queue.length === 0 ? (
                <EmptyState
                  title="Inga öppna åtgärder"
                  hint="Allt ser bra ut. Kör en ny prismatchning för att hämta färska konkurrentpriser."
                />
              ) : (
                <ul>
                  {queue.map((q) => (
                    <li key={q.key}>
                      <Link
                        to={q.to as any}
                        className="group flex items-center justify-between gap-4 border-b border-border px-5 py-3 last:border-b-0 hover:bg-muted"
                      >
                        <div className="flex items-center gap-3">
                          <Tone tone={q.tone}>{q.count}</Tone>
                          <div className="text-[13px] font-medium">{q.title}</div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-subtle group-hover:text-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between border-b border-border px-5 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  Senaste körningar
                </div>
                <Link
                  to="/runs"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Alla →
                </Link>
              </div>
              {runs.error && <ErrorState error={runs.error} />}
              {runs.isLoading ? (
                <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar…</div>
              ) : latestRuns.length === 0 ? (
                <EmptyState title="Inga körningar än" hint="Starta din första prismatchning ovan." />
              ) : (
                <ul>
                  {latestRuns.map((r) => (
                    <li key={r.id}>
                      <Link
                        to="/reports/$runId"
                        params={{ runId: String(r.id) }}
                        className="block border-b border-border px-5 py-2 hover:bg-muted"
                      >
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="font-mono">#{r.id}</span>
                          <Tone
                            tone={
                              r.status === "completed"
                                ? "ok"
                                : r.status === "running"
                                  ? "info"
                                  : r.status === "failed"
                                    ? "err"
                                    : "muted"
                            }
                          >
                            {r.status}
                          </Tone>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{fmtDate(r.started_at)}</span>
                          <span className="font-mono">
                            {r.success_count}/{r.total_links_checked} OK
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      }
    />
  );
}
