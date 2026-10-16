// PWA (§9): service worker, update prompt, install prompt (Android/desktop), iOS sheet, app badge.
import { useEffect, useState } from "react";
import { Button } from "./ui";
import { editingNow, Sheet, snack } from "./sheet";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const DISMISSED = "kharcha.install.dismissed";
const IOS_SEEN = "kharcha.install.ios";
const ADDS = "kharcha.adds";

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);

/** Settings → Install: always available. Returns false when the OS gives no prompt (iOS or installed). */
export async function promptInstall(): Promise<"prompted" | "ios" | "installed" | "unavailable"> {
  if (isStandalone()) return "installed";
  if (deferred) {
    await deferred.prompt();
    deferred = null;
    return "prompted";
  }
  return isIOS() ? "ios" : "unavailable";
}

/** Call after each successful add; the 3rd add offers install once (Android, desktop Chrome). */
export function countAdd() {
  const n = Number(localStorage.getItem(ADDS) ?? 0) + 1;
  localStorage.setItem(ADDS, String(n));
  if (n < 3 || localStorage.getItem(DISMISSED) || isStandalone()) return;
  if (deferred)
    snack("Install Kharcha for one-tap adding", { label: "Install", onClick: () => void promptInstall() }, {
      label: "Not now",
      onClick: () => localStorage.setItem(DISMISSED, "1"),
    });
  else if (isIOS() && !localStorage.getItem(IOS_SEEN)) for (const l of listeners) l();
}

export function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => {});
}

export function Pwa() {
  const [iosSheet, setIosSheet] = useState(false);
  useEffect(() => {
    const open = () => setIosSheet(true);
    listeners.add(open);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as InstallEvent;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          const offer = (worker: ServiceWorker) => {
            const show = () => {
              // Never reload over an open sheet or form; check again shortly.
              if (editingNow()) return void setTimeout(show, 5000);
              snack("New version ready", {
                label: "Reload",
                onClick: () => {
                  worker.postMessage("skip-waiting");
                  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
                },
              });
            };
            show();
          };
          if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const w = reg.installing;
            w?.addEventListener("statechange", () => {
              if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
            });
          });
        })
        .catch(() => {});
    }
    return () => {
      listeners.delete(open);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  if (!iosSheet) return null;
  const close = () => {
    localStorage.setItem(IOS_SEEN, "1");
    setIosSheet(false);
  };
  return <IosInstallSheet onClose={close} />;
}

export function IosInstallSheet({ onClose }: { onClose: () => void }) {
  const steps = [
    ["Tap", "•••  in the address bar", ""],
    ["Tap", "Share", ""],
    ["Choose", "Add to Home Screen", ""],
  ] as const;
  return (
    <Sheet title="Put Kharcha on your home screen" onClose={onClose}>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map(([pre, bold, post], i) => (
          <li key={bold} className="flex items-center gap-3 border-b border-hairline pb-3 text-[15px]">
            <span className="font-serif text-lg text-brand">{i + 1}</span>
            <span>
              {pre} <strong className="font-semibold">{bold}</strong>
              {post}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex justify-end gap-2">
        <Button variant="text" onClick={onClose}>Not now</Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Sheet>
  );
}
