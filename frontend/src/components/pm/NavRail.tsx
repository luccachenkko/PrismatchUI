import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  CalendarClock,
  FileBarChart,
  LayoutGrid,
  Package,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; exact?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, exact: true },
  { to: "/products", label: "Produkter", icon: Package },
  { to: "/runs", label: "Prismatchning", icon: Activity },
  { to: "/schedules", label: "Schemaläggning", icon: CalendarClock },
  { to: "/reports", label: "Rapporter", icon: FileBarChart },
];

export function NavRail() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health().then(() => true).catch(() => false),
    refetchInterval: 15000,
  });

  return (
    <aside className="nav-rail flex h-full w-[236px] shrink-0 flex-col border-r">
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
        <div className="nav-brand-dot h-2.5 w-2.5 rounded-full" />
        <div className="text-[13px] font-semibold tracking-tight text-white">
          Pricematch<span className="nav-muted"> · Control</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="nav-muted px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider">
          Arbetsyta
        </div>
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = item.exact ? path === item.to : path.startsWith(item.to);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`nav-item flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] transition-colors ${
                    active ? "nav-item-active font-medium" : ""
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-4 py-3 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="nav-muted">Backend</span>
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
