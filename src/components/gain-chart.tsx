export function GainChart({ values, invested }: { values: number[]; invested: number }) {
  const max = Math.max(invested, ...values, 1); const width = 640; const height = 150;
  const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * width},${height - value / max * (height - 16)}`).join(" ");
  const line = `${0},${height - invested / max * (height - 16)} ${width},${height - invested / max * (height - 16)}`;
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Portfolio value and invested amount over time" className="h-36 w-full overflow-visible"><polyline points={line} fill="none" stroke="var(--color-on-ink-pace)" strokeDasharray="5 5" /><polyline points={points} fill="none" stroke="var(--color-on-ink)" strokeWidth="2" /></svg>;
}
