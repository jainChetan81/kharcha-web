import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale lives in styles.css; without this, twMerge reads text-meta as a colour and drops it next to text-ink-2.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "meta", "control", "body", "entry", "section", "title", "page", "page-lg", "figure-sm", "figure", "figure-lg"],
    },
  },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
