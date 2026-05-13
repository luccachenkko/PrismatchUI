import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/api";
import { Btn, EmptyState, ErrorState, Field, TextInput, Workspace } from "@/components/pm/Workspace";
import { Tone } from "@/components/pm/StatusPill";
import type { Schedule, ScheduleFrequencyType, SchedulePayload, ScheduleScopeType } from "@/lib/types";

const DEFAULT_FORM: SchedulePayload = {
  name: "",
  task_type: "sync_and_price_match",
  scope_type: "ready",
  frequency_type: "daily",
  time_of_day: "06:00",
  interval_hours: 6,
  weekday: 1,
  timezone: "Europe/Stockholm",
  enabled: true,
};

const SCOPE_LABELS: Record<ScheduleScopeType, string> = {
  all_active: "Alla aktiva produkter",
  in_stock: "Bara produkter med eget lager",
  ready: "Redo för prismatchning",
};

const FREQUENCY_LABELS: Record<ScheduleFrequencyType, string> = {
  daily: "Dagligen vid vald tid",
  hourly: "Var X:e timme",
  weekly: "Veckovis vald dag + tid",
};

const WEEKDAYS = [
  { value: 1, label: "Måndag" },
  { value: 2, label: "Tisdag" },
  { value: 3, label: "Onsdag" },
  { value: 4, label: "Torsdag" },
  { value: 5, label: "Fredag" },
  { value: 6, label: "Lördag" },
  { value: 7, label: "Söndag" },
];

export function SchedulesRoute() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: api.schedules,
    refetchInterval: 30_000,
  });

  const schedules = data?.schedules ?? [];
  const activeCount = schedules.filter((schedule) => schedule.enabled === 1).length;

  const save = useMutation({
    mutationFn: (payload: { id: number | null; data: SchedulePayload }) =>
      payload.id ? api.updateSchedule(payload.id, payload.data) : api.createSchedule(payload.data),
    onSuccess: () => {
      toast.success("Schemat sparades");
      setFormOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const remove = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: () => {
      toast.success("Schemat togs bort");
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const runNow = useMutation({
    mutationFn: api.runScheduleNow,
    onSuccess: (result) => {
      toast.success(result.run ? `Schema kördes och skapade rapport #${result.run.id}` : "Schema kördes");
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      if (result.run) {
        navigate({ to: "/reports/$runId", params: { runId: String(result.run.id) } });
      }
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (schedule: Schedule) => {
    setEditing(schedule);
    setFormOpen(true);
  };

  return (
    <Workspace
      title="Schemaläggning"
      subtitle={`${schedules.length} scheman · ${activeCount} aktiva`}
      actions={
        <Btn variant="primary" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          Lägg till schema
        </Btn>
      }
      main={
        <div className="relative min-h-full">
          {error && <ErrorState error={error} />}
          {isLoading ? (
            <div className="px-5 py-6 text-[12px] text-muted-foreground">Laddar...</div>
          ) : schedules.length === 0 ? (
            <EmptyState
              title="Inga scheman finns än"
              hint="Skapa ett schema för att synka Shopify och skapa en prismatchningsrapport vid valda tider."
              action={
                <Btn variant="primary" onClick={openNew}>
                  <Plus className="h-3.5 w-3.5" />
                  Lägg till schema
                </Btn>
              }
            />
          ) : (
            <table className="data-table">
              <thead className="sticky top-0 text-left">
                <tr>
                  <th className="border-b border-border px-3 py-2">Namn</th>
                  <th className="border-b border-border px-3 py-2">Gör</th>
                  <th className="border-b border-border px-3 py-2">Produkter</th>
                  <th className="border-b border-border px-3 py-2">Frekvens</th>
                  <th className="border-b border-border px-3 py-2">Aktiv</th>
                  <th className="border-b border-border px-3 py-2">Senast körd</th>
                  <th className="border-b border-border px-3 py-2">Nästa körning</th>
                  <th className="border-b border-border px-3 py-2">Senaste rapport</th>
                  <th className="border-b border-border px-3 py-2 text-right">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id} >
                    <td className="max-w-[260px] px-3 py-2">
                      <div className="font-medium">{schedule.name}</div>
                      {schedule.last_error && (
                        <div className="mt-0.5 truncate text-[11px] text-err" title={schedule.last_error}>
                          {schedule.last_error}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">{taskLabel(schedule.task_type)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{SCOPE_LABELS[schedule.scope_type]}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatFrequency(schedule)}</td>
                    <td className="px-3 py-2">
                      <Tone tone={schedule.enabled ? "ok" : "muted"}>{schedule.enabled ? "Aktiv" : "Inaktiv"}</Tone>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(schedule.last_run_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(schedule.next_run_at)}</td>
                    <td className="px-3 py-2">
                      {schedule.last_run_id ? (
                        <Link
                          to="/reports/$runId"
                          params={{ runId: String(schedule.last_run_id) }}
                          className="font-mono text-[11px] text-info hover:underline"
                        >
                          #{schedule.last_run_id}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        <Btn
                          size="xs"
                          onClick={() => runNow.mutate(schedule.id)}
                          disabled={runNow.isPending}
                        >
                          <Play className="h-3 w-3" />
                          Kör nu
                        </Btn>
                        <Btn size="xs" onClick={() => openEdit(schedule)}>
                          <Pencil className="h-3 w-3" />
                          Redigera
                        </Btn>
                        <Btn
                          size="xs"
                          variant="danger"
                          onClick={() => {
                            if (window.confirm("Ta bort schemat?")) {
                              remove.mutate(schedule.id);
                            }
                          }}
                          disabled={remove.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                          Ta bort
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {formOpen && (
            <ScheduleFormPanel
              schedule={editing}
              saving={save.isPending}
              onClose={() => {
                setFormOpen(false);
                setEditing(null);
              }}
              onSave={(payload) => save.mutate({ id: editing?.id ?? null, data: payload })}
            />
          )}
        </div>
      }
    />
  );
}

function ScheduleFormPanel({
  schedule,
  saving,
  onClose,
  onSave,
}: {
  schedule: Schedule | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: SchedulePayload) => void;
}) {
  const initial = useMemo<SchedulePayload>(() => scheduleToForm(schedule), [schedule]);
  const [form, setForm] = useState<SchedulePayload>(initial);

  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-background/60">
      <div className="flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-sm">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div>
            <div className="text-[13px] font-semibold">{schedule ? "Redigera schema" : "Lägg till schema"}</div>
            <div className="text-[11px] text-muted-foreground">Välj uppgift, produkter och när den ska köras.</div>
          </div>
          <Btn variant="ghost" size="xs" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Btn>
        </div>

        <form
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(form);
          }}
        >
          <div className="space-y-4">
            <Field label="Namn">
              <TextInput
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Daglig prismatchning"
                required
              />
            </Field>

            <Field label="Vad ska schemat göra?">
              <Select
                value={form.task_type}
                onChange={() => setForm((current) => ({ ...current, task_type: "sync_and_price_match" }))}
              >
                <option value="sync_and_price_match">Shopify-synk + prismatchning</option>
              </Select>
            </Field>

            <Field label="Vilka produkter ska ingå?">
              <Select
                value={form.scope_type}
                onChange={(value) => setForm((current) => ({ ...current, scope_type: value as ScheduleScopeType }))}
              >
                <option value="all_active">Alla aktiva produkter</option>
                <option value="in_stock">Bara produkter med eget lager</option>
                <option value="ready">Redo för prismatchning</option>
              </Select>
            </Field>

            <Field label="När ska det köras?">
              <Select
                value={form.frequency_type}
                onChange={(value) =>
                  setForm((current) => ({ ...current, frequency_type: value as ScheduleFrequencyType }))
                }
              >
                <option value="daily">Dagligen vid vald tid</option>
                <option value="hourly">Var X:e timme</option>
                <option value="weekly">Veckovis vald veckodag + tid</option>
              </Select>
            </Field>

            {form.frequency_type === "hourly" ? (
              <Field label="Intervall i timmar">
                <TextInput
                  type="number"
                  min={1}
                  max={168}
                  value={form.interval_hours ?? 6}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      interval_hours: Number.parseInt(event.target.value, 10) || 1,
                    }))
                  }
                />
              </Field>
            ) : (
              <Field label="Tid">
                <TextInput
                  type="time"
                  value={form.time_of_day ?? "06:00"}
                  onChange={(event) => setForm((current) => ({ ...current, time_of_day: event.target.value }))}
                />
              </Field>
            )}

            {form.frequency_type === "weekly" && (
              <Field label="Veckodag">
                <Select
                  value={String(form.weekday ?? 1)}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, weekday: Number.parseInt(value, 10) || 1 }))
                  }
                >
                  {WEEKDAYS.map((weekday) => (
                    <option key={weekday.value} value={weekday.value}>
                      {weekday.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Timezone">
              <TextInput
                value={form.timezone}
                onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}
              />
            </Field>

            <label className="flex items-center justify-between border border-border px-3 py-2 text-[12px]">
              <span>
                <span className="block font-medium">Aktiv</span>
                <span className="text-[11px] text-muted-foreground">Inaktiva scheman körs inte automatiskt.</span>
              </span>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
            </label>
          </div>
        </form>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <Btn onClick={onClose}>Avbryt</Btn>
          <Btn variant="primary" onClick={() => onSave(form)} disabled={saving}>
            Spara schema
          </Btn>
        </div>
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

function scheduleToForm(schedule: Schedule | null): SchedulePayload {
  if (!schedule) {
    return DEFAULT_FORM;
  }

  return {
    name: schedule.name,
    task_type: schedule.task_type,
    scope_type: schedule.scope_type,
    frequency_type: schedule.frequency_type,
    time_of_day: schedule.time_of_day ?? "06:00",
    interval_hours: schedule.interval_hours ?? 6,
    weekday: schedule.weekday ?? 1,
    timezone: schedule.timezone || "Europe/Stockholm",
    enabled: Boolean(schedule.enabled),
  };
}

function taskLabel(taskType: string): string {
  if (taskType === "sync_and_price_match") return "Shopify-synk + prismatchning";
  if (taskType === "shopify_sync_only") return "Shopify-synk";
  if (taskType === "price_match_only") return "Prismatchning";
  if (taskType === "top_products_price_match") return "Bästsäljare";
  return taskType;
}

function formatFrequency(schedule: Schedule): string {
  if (schedule.frequency_type === "hourly") {
    return `Var ${schedule.interval_hours ?? 6}:e timme`;
  }

  if (schedule.frequency_type === "weekly") {
    const weekday = WEEKDAYS.find((item) => item.value === schedule.weekday)?.label ?? "Veckovis";
    return `${weekday} ${schedule.time_of_day ?? "06:00"}`;
  }

  return `${FREQUENCY_LABELS[schedule.frequency_type]} ${schedule.time_of_day ?? "06:00"}`;
}
