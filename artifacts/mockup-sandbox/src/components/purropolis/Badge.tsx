import type { CSSProperties, ReactNode } from "react";

export type BadgeTone = "success" | "warning" | "danger" | "info";

export interface BadgeProps {
  tone?: BadgeTone;
  children?: ReactNode;
  style?: CSSProperties;
}

const tones: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  success: {
    bg: "var(--status-success-soft)",
    fg: "var(--olive-700)",
    dot: "var(--status-success)",
  },
  warning: {
    bg: "var(--status-warning-soft)",
    fg: "var(--sun-700)",
    dot: "var(--status-warning)",
  },
  danger: {
    bg: "var(--status-danger-soft)",
    fg: "var(--status-danger)",
    dot: "var(--status-danger)",
  },
  info: {
    bg: "var(--status-info-soft)",
    fg: "var(--aegean-700)",
    dot: "var(--status-info)",
  },
};

export function Badge({ tone = "info", children, style }: BadgeProps) {
  const t = tones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-body)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
        padding: "2px var(--space-2)",
        borderRadius: "var(--radius-pill)",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "var(--radius-circle)",
          background: t.dot,
        }}
      />
      {children}
    </span>
  );
}
