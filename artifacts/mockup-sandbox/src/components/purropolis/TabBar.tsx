import type { CSSProperties, ReactNode } from "react";

export interface TabBarItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

export interface TabBarProps {
  items: TabBarItem[];
  active: string;
  onChange: (key: string) => void;
  /** Render inline instead of fixed to the viewport bottom (useful in demos). */
  inline?: boolean;
  style?: CSSProperties;
}

export function TabBar({ items, active, onChange, inline, style }: TabBarProps) {
  return (
    <nav
      style={{
        ...(inline
          ? {}
          : {
              position: "fixed",
              left: "50%",
              bottom: "var(--space-4)",
              transform: "translateX(-50%)",
              zIndex: 50,
            }),
        display: "flex",
        gap: "var(--space-1)",
        padding: "var(--space-1)",
        maxWidth: "var(--container-app)",
        background: "rgba(254, 252, 247, 0.78)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: "var(--border-width) solid var(--border-soft)",
        borderRadius: "var(--radius-pill)",
        boxShadow: "var(--shadow-lg)",
        fontFamily: "var(--font-body)",
        ...style,
      }}
    >
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(item.key)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              minWidth: 64,
              padding: "var(--space-2) var(--space-3)",
              border: "none",
              cursor: "pointer",
              borderRadius: "var(--radius-pill)",
              background: isActive ? "var(--color-primary-soft)" : "transparent",
              color: isActive ? "var(--color-primary)" : "var(--text-muted)",
              fontSize: "var(--text-3xs)",
              fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
              letterSpacing: "var(--tracking-wide)",
              transition: "background var(--dur-fast) var(--ease-standard)",
            }}
          >
            {item.icon && <span style={{ fontSize: "var(--text-lg)" }}>{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
