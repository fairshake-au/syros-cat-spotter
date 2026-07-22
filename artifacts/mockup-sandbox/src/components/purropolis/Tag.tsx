import type { CSSProperties, ReactNode } from "react";

export type TagTone =
  | "neutral"
  | "aegean"
  | "bougain"
  | "sun"
  | "terra"
  | "olive";

export interface TagProps {
  tone?: TagTone;
  children?: ReactNode;
  style?: CSSProperties;
}

const tones: Record<TagTone, CSSProperties> = {
  neutral: { background: "var(--surface-sunk)", color: "var(--text-body)" },
  aegean: { background: "var(--aegean-100)", color: "var(--aegean-800)" },
  bougain: { background: "var(--bougain-100)", color: "var(--bougain-700)" },
  sun: { background: "var(--sun-100)", color: "var(--sun-700)" },
  terra: { background: "var(--terra-100)", color: "var(--terra-700)" },
  olive: { background: "var(--olive-100)", color: "var(--olive-700)" },
};

export function Tag({ tone = "neutral", children, style }: TagProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        fontFamily: "var(--font-body)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
        letterSpacing: "var(--tracking-wide)",
        padding: "2px var(--space-2)",
        borderRadius: "var(--radius-pill)",
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
