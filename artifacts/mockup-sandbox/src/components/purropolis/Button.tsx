import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
}

const variants: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: "var(--color-primary)",
    color: "var(--text-on-primary)",
    border: "var(--border-width) solid transparent",
  },
  accent: {
    background: "var(--color-accent)",
    color: "var(--text-on-primary)",
    border: "var(--border-width) solid transparent",
  },
  secondary: {
    background: "var(--color-primary-soft)",
    color: "var(--color-primary-hover)",
    border: "var(--border-width) solid var(--aegean-200)",
  },
  ghost: {
    background: "transparent",
    color: "var(--color-primary)",
    border: "var(--border-width) solid transparent",
  },
};

const sizes: Record<ButtonSize, CSSProperties> = {
  sm: { fontSize: "var(--text-xs)", padding: "var(--space-1) var(--space-3)", minHeight: 32 },
  md: { fontSize: "var(--text-sm)", padding: "var(--space-2) var(--space-4)", minHeight: 40 },
  lg: { fontSize: "var(--text-md)", padding: "var(--space-3) var(--space-5)", minHeight: 48 },
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  iconLeft,
  iconRight,
  children,
  style,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      style={{
        display: block ? "flex" : "inline-flex",
        width: block ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        fontFamily: "var(--font-display)",
        fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
        borderRadius: "var(--radius-pill)",
        cursor: "pointer",
        boxShadow: variant === "ghost" ? "none" : "var(--shadow-sm)",
        transition: `transform var(--dur-fast) var(--ease-bounce), filter var(--dur-fast) var(--ease-standard)`,
        ...variants[variant],
        ...sizes[size],
        ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(0.96)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
