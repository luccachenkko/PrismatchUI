import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/api";
import { Btn, EmptyState, ErrorState, Workspace } from "@/components/pm/Workspace";
import { Tone } from "@/components/pm/StatusPill";

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
    <div className="metric-tile px-4 py-3">
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

export function DashboardRoute() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: api.products });
  const runs = useQuery({ queryKey: ["runs"], queryFn: api.runs });

  const sync = useMutation({
    mutationFn: api.syncShopify,
    onSuccess: (result) => {
      toast.success(`Synkade ${result.syncedCount} produkter från Shopify`);
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const startRun = useMutation({
    mutationFn: api.startRun,
    onSuccess: (result) => {
      toast.success(`Prismatchningskörning #${result.run.id} klar`);
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      navigate({ to: "/reports/$runId", params: { runId: String(result.run.id) } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const stats = products.data?.stats;
  const latestRuns = runs.data?.runs.slice(0, 8) ?? [];
  const latest = latestRuns[0];
  const queue: {
    key: string;
    title: string;
    count: number;
    to: "/products" | "/reports/$runId";
    params?: { runId: string };
    tone: "warn" | "err" | "ok";
  }[] = [];

  if (stats) {
    if (stats.missingCostPriceCount > 0) {
      queue.push({
        key: "cost",
        title: "Produkter saknar inköpspris",
        count: stats.missingCostPriceCount,
        to: "/products",
        tone: "warn",
      });
    }
    if (stats.missingCompetitorLinksCount > 0) {
      queue.push({
        key: "links",
        title: "Produkter saknar konkurrentlänkar",
        count: stats.missingCompetitorLinksCount,
        to: "/products",
        tone: "warn",
      });
    }
    if (stats.okRecommendationCount > 0 && latest) {
      queue.push({
        key: "ok",
        title: "OK-rader att godkänna i senaste rapport",
        count: stats.okRecommendationCount,
        to: "/reports/$runId",
        params: { runId: String(latest.id) },
        tone: "ok",
      });
    }
    if (stats.errorRecommendationCount + stats.blockedRecommendationCount > 0 && latest) {
      queue.push({
        key: "err",
        title: "Fel/blockerade rader i senaste rapport",
        count: stats.errorRecommendationCount + stats.blockedRecommendationCount,
        to: "/reports/$runId",
        params: { runId: String(latest.id) },
        tone: "err",
      });
    }
  }

  return (
    <Workspace
      title="Kontrollcenter"
      subtitle={stats ? `${stats.productCount} produkter · ${stats.inStockCount} i lager` : "Laddar..."}
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
          {runs.error && <ErrorState error={runs.error} />}

          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Produkter" value={stats?.productCount ?? "—"} />
            <Stat label="I lager" value={stats?.inStockCount ?? "—"} />
            <Stat label="OK-rader" value={stats?.okRecommendationCount ?? "—"} tone="ok" />
            <Stat label="Blockerade" value={stats?.blockedRecommendationCount ?? "—"} tone="warn" />
            <Stat label="Shopify-fel" value={stats?.errorRecommendationCount ?? "—"} tone="err" />
            <Stat label="Senaste körning" value={stats?.latestRun ? fmtDate(stats.latestRun).slice(0, 16) : "—"} />
          </div>

          <div className="grid flex-1 grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-[1fr_390px]">
            <section className="panel overflow-hidden">
              <div className="panel-header">
                <div className="panel-title">
                  Nästa åtgärder
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {queue.length} öppna
                </div>
              </div>
              {products.isLoading ? (
                <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar...</div>
              ) : queue.length === 0 ? (
                <EmptyState
                  title="Inga öppna åtgärder"
                  hint="Allt ser bra ut. Kör en ny prismatchning för att hämta färska konkurrentpriser."
                />
              ) : (
                <ul>
                  {queue.map((item) => (
                    <li key={item.key}>
                      <Link
                        to={item.to}
                        params={item.params}
                        className="work-row group"
                      >
                        <div className="flex items-center gap-3">
                          <Tone tone={item.tone}>{item.count}</Tone>
                          <div className="text-[13px] font-medium">{item.title}</div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-subtle group-hover:text-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel overflow-hidden">
              <div className="panel-header">
                <div className="panel-title">
                  Senaste körningar
                </div>
                <Link to="/reports" className="text-[11px] text-muted-foreground hover:text-foreground">
                  Alla →
                </Link>
              </div>
              {runs.isLoading ? (
                <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar...</div>
              ) : latestRuns.length === 0 ? (
                <EmptyState title="Inga körningar än" hint="Starta din första prismatchning ovan." />
              ) : (
                <ul>
                  {latestRuns.map((run) => (
                    <li key={run.id}>
                      <Link
                        to="/reports/$runId"
                        params={{ runId: String(run.id) }}
                        className="work-row block"
                      >
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="font-mono">#{run.id}</span>
                          <Tone tone={statusTone(run.status)}>{run.status}</Tone>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{fmtDate(run.started_at)}</span>
                          <span className="font-mono">
                            {run.success_count}/{run.total_links_checked} OK
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
      contextTitle="Status"
      context={
        <div>
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <Activity className="h-4 w-4" />
              Systemläge
            </div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              Alla siffror kommer från befintliga API-endpoints och lokal SQLite.
            </div>
          </div>
          <div className="px-4 py-3 text-[12px]">
            <div className="flex items-center justify-between border-b border-border py-1">
              <span className="text-muted-foreground">Produkter laddade</span>
              <span className="font-mono">{products.data?.products.length ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border py-1">
              <span className="text-muted-foreground">Körningar laddade</span>
              <span className="font-mono">{runs.data?.runs.length ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Senaste status</span>
              <span>{latest ? <Tone tone={statusTone(latest.status)}>{latest.status}</Tone> : "—"}</span>
            </div>
          </div>
        </div>
      }
    />
  );
}

function statusTone(status: string): "ok" | "warn" | "err" | "muted" | "info" {
  if (status === "completed") return "ok";
  if (status === "running") return "info";
  if (status === "failed") return "err";
  return "muted";
}
