import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { NavRail } from "@/components/pm/NavRail";

function NotFoundComponent() {
  return (
    <Shell>
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
            404
          </div>
          <h1 className="mt-1 text-[16px] font-semibold">Hittades inte</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Vyn finns inte i kontrollcentret.
          </p>
          <div className="mt-3">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-sm border border-border bg-surface px-2.5 py-1 text-[12px] font-medium hover:bg-muted"
            >
              Till Dashboard
            </Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <Shell>
      <div className="m-4 max-w-2xl rounded-sm border border-err/40 bg-err-bg p-3 text-[12px] text-err">
        <div className="font-semibold">Vyn kunde inte laddas</div>
        <div className="mt-1 break-all opacity-80">{error.message}</div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-sm border border-err/40 bg-surface px-2 py-1 text-err hover:bg-err hover:text-white"
          >
            Försök igen
          </button>
        </div>
      </div>
    </Shell>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Pricematch · Control" },
      { name: "description", content: "Internt prismatchnings-kontrollcenter" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <NavRail />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Shell>
        <Outlet />
      </Shell>
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}
