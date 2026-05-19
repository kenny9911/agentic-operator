export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  filled?: boolean;
}

export function Sparkline({
  values,
  width = 80,
  height = 22,
  color = "var(--signal)",
  filled = true,
}: SparklineProps) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const pad = 1.5;
  const stepX = (width - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map(
    (v, i) =>
      `${pad + i * stepX},${pad + (height - pad * 2) * (1 - (v - min) / range)}`,
  );
  const linePath = "M" + pts.join(" L");
  const areaPath = `${linePath} L${pad + (values.length - 1) * stepX},${height - pad} L${pad},${height - pad} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {filled && <path d={areaPath} fill={color} opacity={0.12} />}
      <path d={linePath} stroke={color} fill="none" strokeWidth={1.25} />
    </svg>
  );
}
