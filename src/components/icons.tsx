// Stroke icons from the boards (24 grid, 1.75, round). Lucide covers anything else.
import type { ReactNode, SVGProps } from "react";

const I = ({ children, size = 22, ...p }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);
export const TodayIcon = () => <I><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></I>;
export const ActivityIcon = () => <I><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></I>;
export const PlanIcon = () => <I><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></I>;
export const WealthIcon = () => <I><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></I>;
export const InsightsIcon = () => <I><path d="M5 20V10M12 20V4M19 20v-7" /></I>;
export const PlusIcon = () => <I size={24} strokeWidth={2}><path d="M12 5v14M5 12h14" /></I>;
export const AskIcon = () => <I size={16}><path d="M4 5h16v11H9l-5 4z" /></I>;
export const ChevronLeft = () => <I size={20}><path d="M15 18l-6-6 6-6" /></I>;
export const ChevronRight = () => <I size={20}><path d="M9 18l6-6-6-6" /></I>;
export const GearIcon = () => (
  <I size={20}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </I>
);
