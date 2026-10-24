// Ledger primitives (Style board §5). shadcn-style: Tailwind classes on real elements, restyled with tokens.
import { Link, type LinkProps } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useId, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "outline" | "text" | "danger" | "brand";
// Hover lightens fills, pressed scales to 0.97 (§19); disabled look lives in styles.css.
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper px-[18px] rounded-button hover:bg-ink/85 hover:text-paper",
  outline: "border border-ink text-ink px-[18px] rounded-button bg-transparent hover:bg-sunken hover:text-ink",
  brand: "bg-brand text-on-brand px-[18px] rounded-button hover:bg-brand/85 hover:text-on-brand",
  text: "text-brand px-2.5 bg-transparent rounded-button hover:bg-brand-soft",
  danger: "text-over px-2.5 bg-transparent rounded-button hover:bg-over-soft hover:text-over",
};
export const buttonClass = (variant: Variant = "primary", className?: string) =>
  cn("inline-flex min-h-11 items-center justify-center gap-2 text-[15px] font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100", variants[variant], className);

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

/** Link that looks like a Button. */
export function ButtonLink({ variant = "primary", className, ...props }: LinkProps & { variant?: Variant; className?: string; children?: ReactNode }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function IconButton({ label, className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type={type} aria-label={label} className={cn("inline-flex size-11 items-center justify-center rounded-button text-ink transition-[background-color,transform] duration-150 hover:bg-sunken active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100", className)} {...props} />;
}

/** Selectable pill (category picker, filters). */
export function Chip({ on, className, children, dot, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; dot?: string }) {
  return (
    <button
      type={type}
      aria-pressed={on}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-chip border px-3.5 text-sm transition-transform active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand desk:min-h-9",
        on ? "border-brand bg-brand text-on-brand" : "border-field bg-card text-ink",
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="size-[7px] rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

/** Segmented control on a sunken track. Native radios, styled. */
export function Segmented<T extends string>({
  options, value, onChange, label, className,
}: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const name = useId();
  return (
    <fieldset className={cn("m-0 grid min-w-0 gap-1 rounded-card border-0 p-1", "bg-sunken", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex min-h-11 cursor-pointer desk:min-h-9 items-center justify-center rounded-inner text-sm font-medium transition-colors motion-reduce:transition-none has-focus-visible:outline-3 has-focus-visible:outline-brand",
              on ? "bg-raised text-ink shadow-control" : "text-ink-2 hover:text-ink",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        );
      })}
    </fieldset>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  // 44px tall button around the 28px track (§11 targets).
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group -my-2 flex h-11 shrink-0 items-center rounded-full focus-visible:outline-none"
    >
      <span className={cn("flex h-7 w-12 rounded-full p-[3px] transition-colors motion-reduce:transition-none group-focus-visible:outline-3 group-focus-visible:outline-offset-2 group-focus-visible:outline-brand", checked ? "justify-end bg-brand" : "justify-start bg-field")}>
        <motion.span layout transition={{ duration: 0.15 }} className="size-[22px] rounded-full bg-thumb shadow-control" />
      </span>
    </button>
  );
}

/** `error` shows under the input in `over`, sets aria-invalid and is announced via aria-describedby. */
export function Field({ label, id, hint, error, className, ...props }: ComponentProps<"input"> & { label: string; id: string; hint?: ReactNode; error?: ReactNode }) {
  const note = error ?? hint;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] text-ink-2">{label}</label>
      <input id={id} className={cn("field", error && "border-over")} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={note ? `${id}-note` : undefined} {...props} />
      {note && <span id={`${id}-note`} role={error ? "alert" : undefined} className={cn("text-[13px]", error ? "text-over" : "text-ink-2")}>{note}</span>}
    </div>
  );
}

/** Serif section heading over a 1px ink rule, optional right-side link or text. */
export function SectionHead({ title, action, as: H = "h2", id }: { title: ReactNode; action?: ReactNode; as?: "h2" | "h3"; id?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-ink pb-2">
      <H id={id} className="m-0 font-serif text-lg font-medium">{title}</H>
      {action && <span className="text-sm">{action}</span>}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-rule bg-card", className)} {...props} />;
}

/** Dashed card: something Kharcha guessed. */
export function Suggestion({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-dashed border-field p-4", className)} {...props} />;
}

const tagTones = {
  unusual: "bg-watch-soft text-watch-text",
  check: "bg-brand-soft text-brand-deep",
  neutral: "bg-sunken text-ink-2",
  ai: "bg-brand-soft text-brand-deep",
  over: "bg-over-soft text-over",
  ok: "bg-earn-soft text-earn",
  pending: "bg-brand-soft text-brand",
  partly: "bg-watch-soft text-watch-text",
  reimbursed: "bg-earn-soft text-earn",
  extra: "bg-earn-soft text-earn",
  cancelled: "bg-sunken text-ink-2",
} as const;
export function StatusTag({ tone, children, className }: { tone: keyof typeof tagTones; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex rounded-chip px-2 py-0.5 text-xs font-semibold", tagTones[tone], className)}>{children}</span>;
}

/** Category swatch + label; colour never alone. */
export function CategoryDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-dot" style={{ width: size, height: size, background: `var(--color-${color})` }} />;
}

/** Page header for non-hero screens: serif title, optional back link and actions. */
export function PageHeader({ title, back, backParams, actions, sub }: { title: ReactNode; back?: LinkProps["to"]; backParams?: Record<string, string>; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 desk:px-0">
      <div className="flex min-w-0 items-center">
        {back && (
          <Link to={back} params={backParams as never} activeOptions={{ exact: true }} aria-label="Back" className="-ml-3 flex size-11 items-center justify-center text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
        )}
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 line-clamp-2 font-serif text-[26px] leading-tight font-medium break-words">{title}</h1>
          {sub && <span className="text-[13px] text-ink-3">{sub}</span>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** List screen states (§6): one line plus one action. */
export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-8 text-[15px] text-ink-2">
      <p className="m-0">{text}</p>
      {action}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => `sk${i}`).map((k) => (
        <div key={k} className="flex min-h-14 items-center justify-between border-b border-hairline">
          <span className="h-3.5 w-40 animate-pulse rounded-mark bg-sunken motion-reduce:animate-none" />
          <span className="h-3.5 w-14 animate-pulse rounded-mark bg-sunken motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ text = "Couldn't load this.", retry, back, backLabel = "Back to Today" }: { text?: string; retry?: () => void; back?: LinkProps["to"]; backLabel?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 px-5 py-8 text-[15px] text-ink-2 desk:px-0">
      <p className="m-0">{text}</p>
      <div className="flex gap-2">
        {retry && <Button variant="outline" onClick={retry}>Retry</Button>}
        {back && <ButtonLink to={back} variant="text">{backLabel}</ButtonLink>}
      </div>
    </div>
  );
}
