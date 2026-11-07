import { PullRefresh } from "../components/pull-refresh";
import { createRootRoute, HeadContent, Link, Outlet, Scripts, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { LazyMotion, MotionConfig } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { Pwa, setBadge } from "../components/pwa";
import { editingNow, Sheet, Snackbars, snack } from "../components/sheet";
import { watchStaleChunks } from "../lib/stale-chunk";
import { HealthProvider, useHealth } from "../components/sync-pill";
import { Button } from "../components/ui";
import { KEYS, useGlobalKeys } from "../keybindings";
import { getShell } from "../server/fns";
import bodyFont from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url";
import stylesheet from "../styles.css?url";
import { themeBoot, watchSystemTheme } from "../lib/theme";
import { errorText } from "../lib/error-text";

const loadMotionFeatures = () => import("../lib/motion-features").then((mod) => mod.domMax);

export const Route = createRootRoute({
  head: ({ loaderData }) => ({
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
      // Body text font on the first screen; the other faces load on demand.
      { rel: "preload", href: bodyFont, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
    // Page views only: no query string (Activity search can hold merchant names), production host only.
    scripts: loaderData?.umamiWebsiteId
      ? [
          {
            src: "https://umami.chetan-vps.tech/script.js",
            defer: true,
            "data-website-id": loaderData.umamiWebsiteId,
            "data-domains": "kharcha.chetan-vps.tech",
            "data-exclude-search": "true",
            "data-exclude-hash": "true",
          },
        ]
      : [],
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
    <div className="p-6">
      <h1 className="m-0 font-serif text-page">Page not found</h1>
      <p className="mb-0 text-body text-ink-2">
        This address doesn’t match a page. <Link to="/">Go to Today</Link>
      </p>
    </div>
  ),
});

function Layout() {
  const shell = Route.useLoaderData();
  const onLogin = useRouterState({ select: (s) => s.location.pathname === "/login" });
  const health = useHealth();
  const [help, setHelp] = useState(false);
  useGlobalKeys(setHelp);
  useEffect(() => setBadge(shell.reviewCount), [shell.reviewCount]);
  useEffect(() => watchSystemTheme(), []);
  useEffect(
    () => watchStaleChunks(() => snack("A new version is out.", { label: "Reload", onClick: () => location.reload() }), editingNow),
    [],
  );
  if (onLogin)
    return (
      <main id="main" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
    );
  return (
    <LazyMotion features={loadMotionFeatures}>
      <MotionConfig reducedMotion="user">
        <HealthProvider value={health}>
          <AppShell data={shell}>
            <Outlet />
          </AppShell>
          <PullRefresh />
          <Snackbars />
          <Pwa />
          {help && (
            <Sheet title="Shortcuts" onClose={() => setHelp(false)}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
                {KEYS.map((k) => (
                  <div key={k.key} className="contents">
                    <dt>
                      <kbd className="rounded-control border border-hairline bg-paper px-1.5 py-0.5 font-mono text-caption">{k.key}</kbd>
                    </dt>
                    <dd className="m-0">{k.label}</dd>
                  </div>
                ))}
              </dl>
            </Sheet>
          )}
        </HealthProvider>
      </MotionConfig>
    </LazyMotion>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <main id="main" tabIndex={-1} role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-6 px-8 text-center">
      <h1 className="m-0 font-serif text-title leading-snug">
        {offline ? "Can’t reach your server right now." : errorText(error, "Something went wrong.")}
      </h1>
      <Button onClick={reset} className="min-h-12 px-7 text-entry">
        Retry
      </Button>
      <a href="/login" className="text-ink-2 underline">
        Sign in
      </a>
    </main>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <HeadContent />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-control focus:bg-card focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
