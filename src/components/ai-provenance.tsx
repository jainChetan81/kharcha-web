import { aiCost, grouped, ago } from "../lib/format";
import { presets } from "./model-select";

/** One muted line under an AI answer: model, tokens, cost, time. Null parts drop out; old rows show model + time. */
export function AiProvenance({ model, tokensIn, tokensOut, costUsd, when }: { model?: string | null; tokensIn?: number | null; tokensOut?: number | null; costUsd?: number | null; when?: string | null }) {
  const name = model ? (presets.find((preset) => preset.id === model)?.name ?? model) : null;
  const tokens = tokensIn !== null && tokensIn !== undefined && tokensOut !== null && tokensOut !== undefined ? `${grouped(tokensIn + tokensOut)} tokens` : null;
  const cost = costUsd !== null && costUsd !== undefined ? aiCost(costUsd) : null;
  const parts = [name, tokens, cost, when ? ago(when) : null].filter(Boolean);
  return <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">{parts.join(" · ")}</span>;
}
