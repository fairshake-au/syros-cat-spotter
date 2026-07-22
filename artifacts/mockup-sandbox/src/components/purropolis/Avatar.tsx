import type { CSSProperties } from "react";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  src?: string;
  /** Used for alt text and the initial fallback. */
  name: string;
  size?: AvatarSize;
  /** Aegean ring around the avatar. */
  ring?: boolean;
  style?: CSSProperties;
}

const sizes: Record<AvatarSize, number> = { sm: 28, md: 40, lg: 56, xl: 80 };

export function Avatar({ src, name, size = "md", ring, style }: AvatarProps) {
  const d = sizes[size];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: d,
        height: d,
        borderRadius: "var(--radius-circle)",
        overflow: "hidden",
        background: "var(--aegean-200)",
        color: "var(--aegean-800)",
        fontFamily: "var(--font-display)",
        fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
        fontSize: d * 0.42,
        boxShadow: ring
          ? "0 0 0 var(--border-width-thick) var(--color-primary), var(--shadow-xs)"
          : "var(--shadow-xs)",
        ...style,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}
