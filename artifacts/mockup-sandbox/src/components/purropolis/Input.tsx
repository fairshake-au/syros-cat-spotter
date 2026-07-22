import { useId, useState } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  iconLeft?: ReactNode;
}

export function Input({
  label,
  helper,
  error,
  iconLeft,
  style,
  ...rest
}: InputProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? "var(--status-danger)"
    : focused
      ? "var(--border-focus)"
      : "var(--border-soft)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontFamily: "var(--font-body)" }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
            color: "var(--text-body)",
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          background: "var(--surface-card)",
          border: `var(--border-width) solid ${borderColor}`,
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2) var(--space-3)",
          boxShadow: focused ? "var(--shadow-focus)" : "none",
          transition: "box-shadow var(--dur-fast) var(--ease-standard)",
        }}
      >
        {iconLeft && (
          <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>
            {iconLeft}
          </span>
        )}
        <input
          id={id}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-sm)",
            color: "var(--text-strong)",
            ...style,
          }}
          {...rest}
        />
      </div>
      {(error || helper) && (
        <span
          style={{
            fontSize: "var(--text-2xs)",
            color: error ? "var(--status-danger)" : "var(--text-muted)",
          }}
        >
          {error || helper}
        </span>
      )}
    </div>
  );
}
