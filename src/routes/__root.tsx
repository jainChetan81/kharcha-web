import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Kharcha" },
      { name: "theme-color", content: "#2f4a7a" },
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
  shellComponent: Document,
  component: Layout,
  errorComponent: RootError,
  notFoundComponent: () => (
    <p className="p-6">
      Page not found. <Link to="/">Go to Today</Link>
    </p>
  ),
});

const tabs = [
  { to: "/", label: "Today" },
  { to: "/history", label: "History" },
  { to: "/add", label: "Add" },
] as const;

function Layout() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <main className="flex-1 px-4 pt-6 pb-24">
        <Outlet />
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map((t) => (
            <li key={t.to} className="flex-1">
              <Link
                to={t.to}
                className="flex min-h-14 items-center justify-center text-sm font-semibold text-ink/60"
                activeProps={{ className: "text-brand", "aria-current": "page" }}
                activeOptions={{ exact: true }}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="p-6" role="alert">
      <h1 className="text-xl font-semibold">Kharcha could not load</h1>
      <p className="mt-2 text-ink/70">{typeof navigator !== "undefined" && !navigator.onLine ? "You are offline." : error instanceof Error ? error.message : "Something went wrong."}</p>
      <button type="button" className="btn mt-4" onClick={reset}>
        Try again
      </button>
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
