import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface CardProps {
  /** Lift on hover. */
  hover?: boolean;
  /** No shadow, border only. */
  flat?: boolean;
  /** CSS padding value; defaults to var(--space-5). */
  padding?: string | number;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Card({ hover, flat, padding, children, style }: CardProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg)",
        border: flat
          ? "var(--border-width) solid var(--border-soft)"
          : "var(--border-width) solid transparent",
        boxShadow: flat
          ? "none"
          : hovered
            ? "var(--shadow-md)"
            : "var(--shadow-sm)",
        transform: hovered ? "translateY(-2px)" : "none",
        transition:
          "box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
        padding: padding ?? "var(--space-5)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
