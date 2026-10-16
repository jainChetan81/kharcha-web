// Pull to refresh for the installed app, which has no reload button. Refetches route loaders; nothing is cached on the device.
import { useRouter } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { editingNow, snack } from "./sheet";

const TRIGGER = 72;

export function PullRefresh() {
  const router = useRouter();
  const pull = useMotionValue(0);
  const still = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const rotate = useTransform(pull, [0, TRIGGER], [0, 270]);
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
      pull.set(Math.min(120, dy * 0.5));
    };
    const onEnd = () => {
      if (start === null) return;
      start = null;
      if (pull.get() < TRIGGER) return void settle(0);
      running = true;
      setBusy(true);
      settle(48);
      void router
        .invalidate()
        .catch(() => snack(navigator.onLine ? "Couldn’t refresh." : "You’re offline."))
        .finally(() => {
          running = false;
          setBusy(false);
          settle(0);
        });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    const onCancel = () => { start = null; if (!running) settle(0); };
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
      <motion.div aria-hidden style={{ y, opacity }} className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-40 flex justify-center desk:hidden">
        <span className="flex size-9 items-center justify-center rounded-full border border-rule bg-card text-ink shadow-[0_2px_8px_rgba(28,34,48,0.12)]">
          <motion.span style={{ rotate }} className="flex">
            <span className={busy ? "flex animate-spin" : "flex"}><RefreshCw size={18} strokeWidth={1.75} /></span>
          </motion.span>
        </span>
      </motion.div>
      <span className="sr-only" role="status">{busy ? "Refreshing" : ""}</span>
    </>
  );
}
