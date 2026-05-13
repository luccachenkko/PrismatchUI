import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "@/lib/api";
import { EmptyState, ErrorState, Workspace } from "@/components/pm/Workspace";
import { Tone } from "@/components/pm/StatusPill";

export const Route = createFileRoute("/reports/")({
  head: () => ({ meta: [{ title: "Rapporter · Pricematch Control" }] }),
  component: ReportsList,
});

function ReportsList() {
  const { data, error, isLoading } = useQuery({ queryKey: ["runs"], queryFn: api.runs });
  const runs = data?.runs ?? [];

  return (
    <Workspace
      title="Rapporter"
      subtitle={`${runs.length} körningar`}
      main={
        <div>
          {error && <ErrorState error={error} />}
          {isLoading ? (
            <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar…</div>
          ) : runs.length === 0 ? (
            <EmptyState
              title="Inga rapporter än"
              hint="Kör en prismatchning för att skapa din första rapport."
              action={
                <Link
                  to="/runs"
                  className="rounded-sm border border-primary bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground"
                >
                  Till prismatchning
                </Link>
              }
            />
          ) : (
            <ul>
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/reports/$runId"
                    params={{ runId: String(r.id) }}
                    className="flex items-center justify-between border-b border-border px-5 py-3 hover:bg-muted"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold">#{r.id}</span>
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
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {fmtDate(r.started_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-[12px] text-muted-foreground">
                      <span>
                        <span className="font-mono text-foreground">{r.total_products}</span> prod
                      </span>
                      <span>
                        <span className="font-mono text-ok">{r.success_count}</span> OK
                      </span>
                      <span>
                        <span className="font-mono text-err">{r.error_count}</span> fel
                      </span>
                      <span className="text-info">Öppna →</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
    />
  );
}
