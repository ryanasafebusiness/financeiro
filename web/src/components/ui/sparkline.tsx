import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Mini gráfico de linha em SVG puro (sem dependências), com preenchimento em
 * gradiente muito leve e traço desenhado progressivamente na entrada.
 */
export function Sparkline({
  data,
  stroke = "hsl(var(--primary))",
  className,
  height = 44,
  strokeWidth = 1.75,
}: {
  data: number[];
  stroke?: string;
  className?: string;
  height?: number;
  strokeWidth?: number;
}) {
  const id = React.useId();
  const points = data.length >= 2 ? data : [...data, ...data, 0].slice(0, 2);

  const W = 100;
  const H = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = W / (points.length - 1);

  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = H - ((v - min) / span) * (H - 4) - 2;
    return [x, y] as const;
  });

  // Curva suave (Catmull-Rom simplificado para cubic bezier).
  let d = `M ${coords[0][0]} ${coords[0][1]}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className={cn("w-full", className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{
          strokeDasharray: 240,
          strokeDashoffset: 240,
          animation: "spark-draw 900ms var(--ease-out) forwards",
        }}
      />
      <style>{`@keyframes spark-draw { to { stroke-dashoffset: 0; } }`}</style>
    </svg>
  );
}
