import type { CSSProperties } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "var(--font-body)",
        fontSize: "var(--text-sm)",
        color: "var(--text-body)",
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width: 46,
          height: 28,
          borderRadius: "var(--radius-pill)",
          border: "none",
          padding: 3,
          cursor: "inherit",
          background: checked ? "var(--color-primary)" : "var(--stone-400)",
          transition: "background var(--dur-base) var(--ease-standard)",
          display: "flex",
          justifyContent: checked ? "flex-end" : "flex-start",
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "var(--radius-circle)",
            background: "var(--stone-000)",
            boxShadow: "var(--shadow-sm)",
            transition: "transform var(--dur-base) var(--ease-bounce)",
          } as CSSProperties}
        />
      </button>
      {label}
    </label>
  );
}
