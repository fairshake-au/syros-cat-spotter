import type { CSSProperties } from "react";

export type ProgressTone = "aegean" | "bougain" | "sun" | "olive";

export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: ProgressTone;
  label?: string;
  style?: CSSProperties;
}

const tones: Record<ProgressTone, string> = {
  aegean: "var(--color-primary)",
  bougain: "var(--color-accent)",
  sun: "var(--sun-600)",
  olive: "var(--olive-600)",
};

export function ProgressBar({
  value,
  max = 100,
  tone = "aegean",
  label,
  style,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ display: "grid", gap: "var(--space-1)", fontFamily: "var(--font-body)", ...style }}>
      {label && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "var(--text-2xs)",
            fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
            color: "var(--text-muted)",
          }}
        >
          <span>{label}</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {value}/{max}
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        style={{
          height: 10,
          borderRadius: "var(--radius-pill)",
          background: "var(--surface-sunk)",
          boxShadow: "var(--shadow-inset)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: "var(--radius-pill)",
            background: tones[tone],
            transition: "width var(--dur-slow) var(--ease-out)",
          }}
        />
      </div>
    </div>
  );
}
