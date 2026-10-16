import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "../lib/format";
export function MonthSwitcher({ month, to = "/" }: { month: string; to?: "/" | "/activity" }) { return <div className="flex items-center"><Link to={to} search={{ month: shiftMonth(month, -1) }} aria-label="Previous month" className="flex size-11 items-center justify-center"><ChevronLeft strokeWidth={1.75} /></Link><h1 className="font-serif text-[22px] font-medium">{monthLabel(month)}</h1><Link to={to} search={{ month: shiftMonth(month, 1) }} aria-label="Next month" className="flex size-11 items-center justify-center"><ChevronRight strokeWidth={1.75} /></Link></div>; }
