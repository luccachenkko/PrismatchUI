import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/api";
import { Btn, EmptyState, ErrorState, KV, Section, Workspace } from "@/components/pm/Workspace";
import { Tone } from "@/components/pm/StatusPill";
import type { PriceRun } from "@/lib/types";

function statusTone(status: string): "ok" | "warn" | "err" | "muted" | "info" {
  if (status === "completed") return "ok";
  if (status === "running") return "info";
  if (status === "failed") return "err";
  return "muted";
}

export function RunsRoute() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: api.runs,
    refetchInterval: (query) => {
      const runs = (query.state.data as { runs: PriceRun[] } | undefined)?.runs ?? [];
      return runs.some((run) => run.status === "running") ? 2000 : false;
    },
  });

  const runs = data?.runs ?? [];
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null;

  useEffect(() => {
    if (selectedId === null && runs[0]) setSelectedId(runs[0].id);
  }, [runs, selectedId]);

  const start = useMutation({
    mutationFn: api.startRun,
    onSuccess: (result) => {
      toast.success(`Körning #${result.run.id} klar`);
      setSelectedId(result.run.id);
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Workspace
      title="Prismatchning"
      subtitle={`${runs.length} körningar`}
      actions={
        <Btn variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
          <Play className="h-3.5 w-3.5" />
          Kör ny prismatchning
        </Btn>
      }
      main={
        <div>
          {error && <ErrorState error={error} />}
          {isLoading ? (
            <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar...</div>
          ) : runs.length === 0 ? (
            <EmptyState
              title="Inga körningar än"
              hint="Starta en körning för att hämta färska Shopify-priser, lagernivåer och konkurrentpriser."
            />
          ) : (
            <table className="data-table">
              <thead className="sticky top-0 text-left">
                <tr>
                  <th className="border-b border-border px-3 py-2">Run</th>
                  <th className="border-b border-border px-3 py-2">Status</th>
                  <th className="border-b border-border px-3 py-2">Startad</th>
                  <th className="border-b border-border px-3 py-2">Avslutad</th>
                  <th className="border-b border-border px-3 py-2 text-right">Produkter</th>
                  <th className="border-b border-border px-3 py-2 text-right">Skippade</th>
                  <th className="border-b border-border px-3 py-2 text-right">Länkar</th>
                  <th className="border-b border-border px-3 py-2 text-right">OK</th>
                  <th className="border-b border-border px-3 py-2 text-right">Fel</th>
                  <th className="border-b border-border px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedId(run.id)}
                    className={`cursor-pointer ${selected?.id === run.id ? "is-selected" : ""}`}
                  >
                    <td className="px-3 py-1.5 font-mono">#{run.id}</td>
                    <td className="px-3 py-1.5">
                      <Tone tone={statusTone(run.status)}>{run.status}</Tone>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{fmtDate(run.started_at)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{fmtDate(run.finished_at)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{run.total_products}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{run.products_skipped_no_stock}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{run.total_links_checked}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-ok">{run.success_count}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-err">{run.error_count}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Link
                        to="/reports/$runId"
                        params={{ runId: String(run.id) }}
                        className="text-[11px] font-medium text-info hover:underline"
                      >
                        Öppna rapport →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      }
      contextTitle={selected ? `Körning #${selected.id}` : "Välj körning"}
      context={
        selected ? (
          <RunContext runId={selected.id} />
        ) : (
          <div className="px-5 py-8 text-[12px] text-muted-foreground">
            Markera en körning för att se progress och statistik.
          </div>
        )
      }
    />
  );
}

function RunContext({ runId }: { runId: number }) {
  const { data, error } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.run(runId),
    refetchInterval: (query) => {
      const report = query.state.data;
      return report?.run.status === "running" ? 2000 : false;
    },
  });

  if (error) return <ErrorState error={error} />;
  if (!data) return <div className="px-5 py-4 text-[12px] text-muted-foreground">Laddar...</div>;
  const { run } = data;
  const isRunning = run.status === "running";

  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[13px] font-semibold">#{run.id}</span>
          <Tone tone={statusTone(run.status)}>{run.status}</Tone>
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(run.started_at)}</div>
      </div>

      {isRunning && (
        <div className="border-b border-border bg-info-bg px-4 py-3 text-[12px] text-info">
          <div className="font-medium">Körning pågår</div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-info/80">
            <li>Färska Shopify-priser och lagernivåer hämtas först.</li>
            <li>Produkter med eget lager ≤ 0 skippas före konkurrenthämtning.</li>
            <li>Scrapers hämtar endast pris från konkurrentlänkar.</li>
          </ul>
        </div>
      )}

      <Section title="Resultat">
        <KV k="Produkter" v={run.total_products} mono />
        <KV k="Skippade (lager 0)" v={run.products_skipped_no_stock} mono />
        <KV k="Länkar kontrollerade" v={run.total_links_checked} mono />
        <KV k="Lyckade" v={<span className="text-ok">{run.success_count}</span>} mono />
        <KV k="Fel" v={<span className="text-err">{run.error_count}</span>} mono />
      </Section>

      <div className="px-4 pb-4">
        <Link
          to="/reports/$runId"
          params={{ runId: String(run.id) }}
          className="block w-full rounded-sm border border-primary bg-primary px-2.5 py-1.5 text-center text-[12px] font-medium text-primary-foreground hover:opacity-90"
        >
          Öppna rapport →
        </Link>
      </div>
    </div>
  );
}
