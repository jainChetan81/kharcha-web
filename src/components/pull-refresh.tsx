// Pull to refresh for the installed app, which has no reload button. Refetches route loaders; nothing is cached on the device.
import { useRouter } from "@tanstack/react-router";
import { Check, RefreshCw, X } from "lucide-react";
import { animate, m, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { editingNow, snackError } from "./sheet";

const TRIGGER = 72;

export function PullRefresh() {
  const router = useRouter();
  const pull = useMotionValue(0);
  const still = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"done" | "failed" | null>(null);
  const rotate = useTransform(pull, [0, TRIGGER - 0.5, TRIGGER], [0, 0, 180]);
  const opacity = useTransform(pull, [0, 24, TRIGGER], [0, 0.4, 1]);
  const y = useTransform(pull, (v) => v - 40);

  useEffect(() => {
    let start: number | null = null;
    let running = false;
    const settle = (to: number) => animate(pull, to, still ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 });
    const onStart = (e: TouchEvent) => {
      // Only from the very top, never over an open sheet or form, one at a time.
      start = window.scrollY <= 0 && !running && !editingNow() && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start === null) return;
      const dy = e.touches[0].clientY - start;
      if (dy <= 0 || window.scrollY > 0) return pull.set(0);
      // Rubber band: resistance grows the further you pull.
      const next = Math.min(120, dy * 0.5);
      if (next >= TRIGGER && pull.get() < TRIGGER) navigator.vibrate?.(10);
      pull.set(next);
    };
    const onEnd = () => {
      if (start === null) return;
      start = null;
      if (pull.get() < TRIGGER) return void settle(0);
      running = true;
      setBusy(true);
      settle(56);
      // Done or failed holds for 1.2 s (DESIGN.md §19), then the ring springs back.
      void router
        .invalidate()
        .then(
          () => "done" as const,
          () => {
            snackError(navigator.onLine ? "Couldn’t refresh. Pull again to retry." : "You’re offline. Pull again once connected.");
            return "failed" as const;
          },
        )
        .then((outcome) => {
          setBusy(false);
          setResult(outcome);
          setTimeout(() => {
            running = false;
            setResult(null);
            settle(0);
          }, 1200);
        });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    const onCancel = () => {
      start = null;
      if (!running) settle(0);
    };
    window.addEventListener("touchcancel", onCancel);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [pull, router, still]);

  return (
    <>
      <m.div
        aria-hidden
        style={{ y, opacity }}
        className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-40 flex justify-center desk:hidden"
      >
        <span className="flex size-9 items-center justify-center rounded-full border border-hairline bg-card text-ink shadow-popover">
          <m.span style={{ rotate }} className="flex">
            {result === "done" ? (
              <Check size={18} strokeWidth={1.75} className="text-earn" />
            ) : result === "failed" ? (
              <X size={18} strokeWidth={1.75} className="text-over" />
            ) : (
              <span className={busy ? "flex animate-spin motion-reduce:animate-none" : "flex"}>
                <RefreshCw size={18} strokeWidth={1.75} />
              </span>
            )}
          </m.span>
        </span>
      </m.div>
      <span className="sr-only" role="status">
        {busy ? "Refreshing" : result === "done" ? "Up to date" : result === "failed" ? "Couldn’t refresh" : ""}
      </span>
    </>
  );
}
