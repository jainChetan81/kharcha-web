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
export const MoreIcon = () => <I><circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.25" fill="currentColor" stroke="none" /></I>;
