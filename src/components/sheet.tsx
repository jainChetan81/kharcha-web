// Bottom sheet on phones, centred dialog at ≥600px (Style board: radius 20, grab handle, 220 ms).
import { Dialog } from "radix-ui";
import { m, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "../lib/cn";

// Sheets and forms register here so the update prompt never reloads over typed input (§9).
let busy = 0;
export const editingNow = () => busy > 0;
export function useHoldsInput(active = true) {
  useEffect(() => {
    if (!active) return;
    busy++;
    return () => {
      busy--;
    };
  }, [active]);
}

export function Sheet({
  title,
  description,
  onClose,
  confirmClose,
  children,
  className,
  swipe = true,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  confirmClose?: () => boolean;
  children: ReactNode;
  className?: string;
  swipe?: boolean;
}) {
  useHoldsInput();
  const reduced = useReducedMotion();
  const close = () => {
    if (!confirmClose || confirmClose()) onClose();
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <m.div
            className="fixed inset-0 z-40 bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.22 }}
          />
        </Dialog.Overlay>
        {/* Snackbars sit outside the sheet: tapping Undo/Retry must not close it. */}
        <Dialog.Content
          asChild
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) event.preventDefault();
          }}
        >
          <m.section
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 36 }}
            // Long scrolling lists turn swipe-to-close off: drag="y" blocks touch scroll and fights row reorder.
            drag={reduced || !swipe ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(event, info) => {
              const height = (event.currentTarget as HTMLElement).offsetHeight;
              if (info.offset.y > height * 0.3 || info.velocity.y > 500) close();
            }}
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-64px)] flex-col gap-3.5 overflow-y-auto rounded-t-sheet bg-card px-4 pt-2 pb-[max(24px,env(safe-area-inset-bottom))] text-ink outline-none",
              "tablet:inset-auto tablet:top-1/2 tablet:left-1/2 tablet:w-[min(560px,calc(100vw-48px))] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-sheet tablet:pt-6",
              className,
            )}
          >
            <div aria-hidden className="h-1 w-9 shrink-0 self-center rounded-control bg-hairline tablet:hidden" />
            <Dialog.Title className="m-0 font-serif text-title font-medium">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="-mt-2 text-meta text-ink-2">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
            {children}
          </m.section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type SnackAction = { label: string; onClick: () => void };

/** Ink snackbar (States board). Info: 6 seconds, one action. Errors stay until dismissed (design guide §12). */
export function snack(text: string, action?: SnackAction, secondary?: SnackAction) {
  // Same plain text replaces the visible snack instead of stacking; snacks with an action (Undo) keep their own.
  toast(text, {
    id: action ? undefined : text,
    duration: 6000,
    action: action && { label: action.label, onClick: action.onClick },
    cancel: secondary && { label: secondary.label, onClick: secondary.onClick },
  });
}

export function deletedSnack(text: string, undo: () => void) {
  snack(text, { label: "Undo", onClick: undo });
}

/** A failure the user should read: no auto-dismiss, with Dismiss (or the given action) to close it. */
export function snackError(text: string, action?: SnackAction) {
  toast(text, {
    id: action ? undefined : text,
    duration: Number.POSITIVE_INFINITY,
    action: action && { label: action.label, onClick: action.onClick },
    cancel: { label: "Dismiss", onClick: () => {} },
  });
}

/** "Couldn't save. Check the connection. · Retry" (§9). */
export const saveFailed = (retry: () => void) => snackError("Couldn’t save. Check the connection.", { label: "Retry", onClick: retry });

export function Snackbars() {
  return (
    <Toaster
      position="bottom-center"
      // Radix modals set pointer-events:none on body; keep snack actions tappable over an open sheet.
      style={{ pointerEvents: "auto" }}
      offset={96}
      mobileOffset={{ bottom: 96 }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex min-h-13 w-[min(358px,calc(100vw-32px))] items-center justify-between gap-2 rounded-panel bg-hero py-1.5 pr-1.5 pl-3.5 text-control text-on-ink shadow-popover",
          title: "leading-snug",
          actionButton: "min-h-11 px-2.5 font-semibold text-on-ink-pace",
          cancelButton: "min-h-11 px-2.5 text-on-ink-2",
        },
      }}
    />
  );
}
