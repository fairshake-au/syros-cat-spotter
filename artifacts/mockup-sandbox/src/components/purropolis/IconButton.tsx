import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from "react";

export type IconButtonVariant = "soft" | "solid" | "ghost" | "accent";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Accessible label — required (icon-only control). */
  label: string;
  children?: ReactNode;
}

const variants: Record<IconButtonVariant, CSSProperties> = {
  soft: { background: "var(--color-primary-soft)", color: "var(--color-primary)" },
  solid: { background: "var(--color-primary)", color: "var(--text-on-primary)" },
  ghost: { background: "transparent", color: "var(--color-primary)" },
  accent: { background: "var(--color-accent)", color: "var(--text-on-primary)" },
};

const sizes: Record<IconButtonSize, number> = { sm: 32, md: 40, lg: 48 };

export function IconButton({
  variant = "soft",
  size = "md",
  label,
  children,
  style,
  ...rest
}: IconButtonProps) {
  const d = sizes[size];
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: d,
        height: d,
        borderRadius: "var(--radius-circle)",
        border: "none",
        cursor: "pointer",
        boxShadow: variant === "ghost" ? "none" : "var(--shadow-xs)",
        transition: `transform var(--dur-fast) var(--ease-bounce)`,
        ...variants[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
