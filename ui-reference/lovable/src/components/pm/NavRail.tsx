import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid,
  Package,
  Activity,
  FileBarChart,
  Settings,
  Radio,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; exact?: boolean };
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, exact: true },
  { to: "/products", label: "Produkter", icon: Package },
  { to: "/runs", label: "Prismatchning", icon: Activity },
  { to: "/reports", label: "Rapporter", icon: FileBarChart },
  { to: "/scrapers", label: "Scraper-status", icon: Radio },
  { to: "/settings", label: "Inställningar", icon: Settings },
];

export function NavRail() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health().then(() => true).catch(() => false),
    refetchInterval: 15000,
  });

  return (
    <aside className="flex h-full w-[208px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-12 items-center gap-2 border-b border-border px-4">
        <div className="h-2 w-2 rounded-full bg-accent" />
        <div className="text-[13px] font-semibold tracking-tight">
          Pricematch<span className="text-muted-foreground"> · Control</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
          Arbetsyta
        </div>
        <ul className="space-y-0.5">
          {NAV.map((n) => {
            const active = n.exact ? path === n.to : path.startsWith(n.to);
            const Icon = n.icon;
            return (
              <li key={n.to}>
                <Link
                  to={n.to as any}
                  className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] transition-colors ${
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-3 py-2 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-subtle">Backend</span>
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health === undefined
                  ? "bg-subtle"
                  : health
                    ? "bg-ok"
                    : "bg-err"
              }`}
            />
            <span className="font-medium">
              {health === undefined ? "—" : health ? "online" : "offline"}
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}
