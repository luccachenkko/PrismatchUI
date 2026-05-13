import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import { NavRail } from "@/components/pm/NavRail";
import { DashboardRoute } from "@/routes/Dashboard";
import { ProductsRoute } from "@/routes/Products";
import { ReportsRoute } from "@/routes/Reports";
import { ReportRoute } from "@/routes/Report";
import { SchedulesRoute } from "@/routes/Schedules";

const queryClient = new QueryClient();

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <NavRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardRoute,
});

const productsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products",
  component: ProductsRoute,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: ReportsRoute,
});

const schedulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/schedules",
  component: SchedulesRoute,
});

const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/$runId",
  component: ReportRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  productsRoute,
  reportsRoute,
  schedulesRoute,
  reportRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
