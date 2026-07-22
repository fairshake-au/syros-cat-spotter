import { useState } from "react";
import type { CSSProperties } from "react";
import { Badge, type BadgeTone } from "./Badge";
import { Tag, type TagTone } from "./Tag";

export interface CatCardProps {
  name: string;
  /** Mono catalog ID, e.g. "SYR-0142". */
  catId: string;
  neighborhood?: string;
  photo?: string;
  status?: string;
  statusTone?: BadgeTone;
  tags?: { label: string; tone?: TagTone }[];
  liked?: boolean;
  onLike?: (liked: boolean) => void;
}

export function CatCard({
  name,
  catId,
  neighborhood,
  photo,
  status,
  statusTone = "info",
  tags = [],
  liked: likedProp,
  onLike,
}: CatCardProps) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = likedProp ?? likedLocal;
  return (
    <div
      style={{
        width: 260,
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        style={{
          position: "relative",
          height: 160,
          background: photo
            ? undefined
            : "linear-gradient(135deg, var(--aegean-200), var(--sun-300))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photo ? (
          <img
            src={photo}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: 48 }} aria-hidden>
            🐱
          </span>
        )}
        <button
          type="button"
          aria-label={liked ? "Unlike" : "Like"}
          aria-pressed={liked}
          onClick={() => {
            const next = !liked;
            setLikedLocal(next);
            onLike?.(next);
          }}
          style={{
            position: "absolute",
            top: "var(--space-2)",
            right: "var(--space-2)",
            width: 34,
            height: 34,
            borderRadius: "var(--radius-circle)",
            border: "none",
            cursor: "pointer",
            background: "rgba(254, 252, 247, 0.85)",
            boxShadow: "var(--shadow-xs)",
            fontSize: 16,
            color: liked ? "var(--color-accent)" : "var(--text-muted)",
            transition: "transform var(--dur-fast) var(--ease-bounce)",
          }}
        >
          {liked ? "❤️" : "🤍"}
        </button>
        {status && (
          <span
            style={{
              position: "absolute",
              bottom: "var(--space-2)",
              left: "var(--space-2)",
            }}
          >
            <Badge tone={statusTone}>{status}</Badge>
          </span>
        )}
      </div>
      <div style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--space-2)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-lg)",
              fontWeight: "var(--weight-semibold)" as CSSProperties["fontWeight"],
              color: "var(--text-strong)",
            }}
          >
            {name}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-2xs)",
              color: "var(--text-faint)",
            }}
          >
            {catId}
          </span>
        </div>
        {neighborhood && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            📍 {neighborhood}
          </span>
        )}
        {tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
            {tags.map((t) => (
              <Tag key={t.label} tone={t.tone}>
                {t.label}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
