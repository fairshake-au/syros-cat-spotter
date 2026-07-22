import type { CSSProperties, ReactNode } from "react";

export type StatTileTone = "aegean" | "bougain" | "sun" | "terra" | "olive" | "neutral";

export interface StatTileProps {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  tone?: StatTileTone;
  style?: CSSProperties;
}

const tones: Record<StatTileTone, { bg: string; fg: string }> = {
  aegean: { bg: "var(--aegean-100)", fg: "var(--aegean-800)" },
  bougain: { bg: "var(--bougain-100)", fg: "var(--bougain-700)" },
  sun: { bg: "var(--sun-100)", fg: "var(--sun-700)" },
  terra: { bg: "var(--terra-100)", fg: "var(--terra-700)" },
  olive: { bg: "var(--olive-100)", fg: "var(--olive-700)" },
  neutral: { bg: "var(--surface-card)", fg: "var(--text-strong)" },
};

export function StatTile({ value, label, icon, tone = "neutral", style }: StatTileProps) {
  const t = tones[tone];
  return (
    <div
      style={{
        background: t.bg,
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        display: "grid",
        gap: "var(--space-1)",
        minWidth: 120,
        boxShadow: tone === "neutral" ? "var(--shadow-sm)" : "none",
        fontFamily: "var(--font-body)",
        ...style,
      }}
    >
      {icon && <span style={{ fontSize: "var(--text-lg)" }}>{icon}</span>}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
          color: t.fg,
          lineHeight: "var(--leading-tight)" as CSSProperties["lineHeight"],
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
          letterSpacing: "var(--tracking-wider)",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
