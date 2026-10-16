// Sparkline: plain SVG polyline scaled to its box. Decorative unless a label is given.
export function Sparkline({ values, width = 80, height = 32, color = "var(--color-earn)", label }: { values: number[]; width?: number; height?: number; color?: string; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
