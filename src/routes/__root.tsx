import { createRootRoute, HeadContent, Link, Outlet, Scripts, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { Dialog } from "radix-ui";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { Pwa, setBadge } from "../components/pwa";
import { Snackbars } from "../components/sheet";
import { HealthProvider, useHealth } from "../components/sync-pill";
import { Button } from "../components/ui";
import { KEYS, useGlobalKeys } from "../keybindings";
import { getShell } from "../server/fns";
import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Kharcha" },
      { name: "theme-color", content: "#1C2230" },
      { name: "robots", content: "noindex" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  // Finance pages: never keep a copy in the browser or any proxy cache.
  headers: () => ({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "frame-ancestors 'none'",
  }),
  loader: () => getShell(),
  shellComponent: Document,
  component: Layout,
  errorComponent: RootError,
  notFoundComponent: () => (
    <p className="p-6">
      Page not found. <Link to="/">Go to Today</Link>
    </p>
  ),
});

function Layout() {
  const shell = Route.useLoaderData();
  const onLogin = useRouterState({ select: (s) => s.location.pathname === "/login" });
  const health = useHealth();
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  useGlobalKeys(openHelp);
  useEffect(() => setBadge(shell.reviewCount), [shell.reviewCount]);
  if (onLogin) return <Outlet />;
  return (
    <MotionConfig reducedMotion="user">
      <HealthProvider value={health}>
        <AppShell data={shell}>
          <Outlet />
        </AppShell>
        <Snackbars />
        <Pwa />
        <ShortcutsDialog open={help} onOpenChange={setHelp} />
      </HealthProvider>
    </MotionConfig>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/45" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-sheet bg-card p-6 text-ink">
          <Dialog.Title className="m-0 font-serif text-[22px] font-medium">Shortcuts</Dialog.Title>
          <Dialog.Description className="sr-only">Keyboard shortcuts</Dialog.Description>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
            {KEYS.map((k) => (
              <div key={k.key} className="contents">
                <dt><kbd className="rounded border border-[#CFCABB] bg-paper px-1.5 py-0.5 font-mono text-xs">{k.key}</kbd></dt>
                <dd className="m-0">{k.label}</dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-6 px-8 text-center">
      <p className="m-0 font-serif text-2xl leading-snug">
        {offline ? "Can’t reach your server right now." : error instanceof Error ? error.message : "Something went wrong."}
      </p>
      <Button onClick={reset} className="min-h-12 px-7 text-base">Retry</Button>
    </main>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
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
