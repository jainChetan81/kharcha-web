import { Link } from "@tanstack/react-router";
import { Card } from "./ui";

export function AiUnavailable() {
  return <Card className="p-4"><p className="m-0 text-[15px] text-ink-2">AI is unavailable right now. Filters still work.</p><Link to="/activity" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand">Open filters</Link></Card>;
}
