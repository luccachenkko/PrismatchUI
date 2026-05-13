import { STATUS_LABELS, STATUS_TONES } from "@/lib/api";

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "muted";
  const label = STATUS_LABELS[status] ?? status;
  const map = {
    ok: "bg-ok-bg text-ok",
    warn: "bg-warn-bg text-warn",
    err: "bg-err-bg text-err",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${map[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function Tone({
  tone = "muted",
  children,
}: {
  tone?: "ok" | "warn" | "err" | "muted" | "info";
  children: React.ReactNode;
}) {
  const map = {
    ok: "bg-ok-bg text-ok",
    warn: "bg-warn-bg text-warn",
    err: "bg-err-bg text-err",
    muted: "bg-muted text-muted-foreground",
    info: "bg-info-bg text-info",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}
