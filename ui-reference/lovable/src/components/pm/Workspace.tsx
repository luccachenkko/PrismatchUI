import { type ReactNode } from "react";

export function Workspace({
  title,
  subtitle,
  actions,
  toolbar,
  main,
  context,
  contextTitle,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  main: ReactNode;
  context?: ReactNode;
  contextTitle?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <section className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="text-[14px] font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <div className="truncate text-[12px] text-muted-foreground">
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
        {toolbar && (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-4">
            {toolbar}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{main}</div>
      </section>
      {context !== undefined && (
        <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-surface">
          <div className="flex h-12 shrink-0 items-center border-b border-border px-4 text-[11px] font-semibold uppercase tracking-wider text-subtle">
            {contextTitle ?? "Kontext"}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{context}</div>
        </aside>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="text-[13px] font-medium text-foreground">{title}</div>
      {hint && <div className="max-w-md text-[12px] text-muted-foreground">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="m-4 rounded-sm border border-err/40 bg-err-bg px-3 py-2 text-[12px] text-err">
      <span className="font-semibold">Fel:</span> {msg}
    </div>
  );
}

export function Btn({
  children,
  variant = "default",
  size = "sm",
  disabled,
  onClick,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "ghost" | "danger" | "ok";
  size?: "sm" | "xs";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
}) {
  const sizes = {
    sm: "h-7 px-2.5 text-[12px]",
    xs: "h-6 px-2 text-[11px]",
  };
  const variants = {
    default:
      "border border-border bg-surface hover:bg-muted text-foreground",
    primary:
      "border border-primary bg-primary text-primary-foreground hover:opacity-90",
    ghost:
      "border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
    danger:
      "border border-err/30 bg-err-bg text-err hover:bg-err hover:text-white",
    ok: "border border-ok/30 bg-ok-bg text-ok hover:bg-ok hover:text-white",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
        {label}
      </div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
) {
  const { mono, className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`block w-full rounded-sm border border-border bg-surface px-2 py-1.5 text-[12px] text-foreground placeholder:text-subtle focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring ${
        mono ? "font-mono" : ""
      } ${className}`}
    />
  );
}

export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
          {title}
        </div>
        {right}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

export function KV({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
      <div className="text-muted-foreground">{k}</div>
      <div className={`text-right text-foreground ${mono ? "font-mono" : ""}`}>{v}</div>
    </div>
  );
}
