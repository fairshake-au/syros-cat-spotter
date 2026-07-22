import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CatCard,
  IconButton,
  Input,
  ProgressBar,
  StatTile,
  Switch,
  Tag,
  TabBar,
} from "../purropolis";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: "var(--space-3)" }}>
      <h2
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-2xs)",
          fontWeight: 800,
          letterSpacing: "var(--tracking-wider)",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default function PurropolisShowcase() {
  const [notifyOn, setNotifyOn] = useState(true);
  const [publicProfile, setPublicProfile] = useState(false);
  const [tab, setTab] = useState("cats");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--surface-page)",
        color: "var(--text-body)",
        fontFamily: "var(--font-body)",
        padding: "var(--space-6) var(--gutter) var(--space-10)",
      }}
    >
      <div
        style={{
          maxWidth: "var(--container-wide)",
          margin: "0 auto",
          display: "grid",
          gap: "var(--space-6)",
        }}
      >
        {/* Wordmark — set in type, no logo binary exists */}
        <header style={{ display: "grid", gap: "var(--space-1)" }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-3xl)",
              fontWeight: "var(--weight-bold)" as CSSProperties["fontWeight"],
              color: "var(--text-strong)",
              letterSpacing: "var(--tracking-tight)",
            }}
          >
            🐾 Purr·<span style={{ color: "var(--color-accent)" }}>opolis</span>
          </span>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            Sun-bleached Cycladic design system — component showcase
          </span>
        </header>

        <Section title="Button">
          <Button variant="primary">Log a sighting</Button>
          <Button variant="accent" size="lg">
            Chip in €5
          </Button>
          <Button variant="secondary">See the catalog</Button>
          <Button variant="ghost">Skip for now</Button>
          <Button variant="primary" size="sm" iconLeft={<span>📍</span>}>
            Near me
          </Button>
          <div style={{ width: 220 }}>
            <Button variant="primary" block>
              Block button
            </Button>
          </div>
        </Section>

        <Section title="IconButton">
          <IconButton variant="soft" label="Like">
            ❤️
          </IconButton>
          <IconButton variant="solid" label="Add sighting">
            ➕
          </IconButton>
          <IconButton variant="accent" label="Favorite" size="lg">
            🐾
          </IconButton>
          <IconButton variant="ghost" label="Close" size="sm">
            ✕
          </IconButton>
        </Section>

        <Section title="Tag">
          <Tag tone="neutral">Shy</Tag>
          <Tag tone="aegean">Ermoupolis</Tag>
          <Tag tone="bougain">Friendly</Tag>
          <Tag tone="sun">Kitten</Tag>
          <Tag tone="terra">Needs vet</Tag>
          <Tag tone="olive">Neutered</Tag>
        </Section>

        <Section title="Badge">
          <Badge tone="success">Desexed</Badge>
          <Badge tone="warning">Pending review</Badge>
          <Badge tone="danger">Needs care</Badge>
          <Badge tone="info">New spot</Badge>
        </Section>

        <Section title="Input">
          <div style={{ width: 280 }}>
            <Input
              label="Cat name"
              placeholder="e.g. Baklava"
              helper="Names must be unique across Syros."
              iconLeft={<span>🐱</span>}
            />
          </div>
          <div style={{ width: 280 }}>
            <Input
              label="Neighborhood"
              defaultValue="Vapori"
              error="Did you mean Vaporia?"
            />
          </div>
        </Section>

        <Section title="Switch">
          <Switch checked={notifyOn} onChange={setNotifyOn} label="Cat updates" />
          <Switch
            checked={publicProfile}
            onChange={setPublicProfile}
            label="Public profile"
          />
        </Section>

        <Section title="Card">
          <Card hover style={{ width: 240 }}>
            <strong style={{ fontFamily: "var(--font-display)", color: "var(--text-strong)" }}>
              Hover card
            </strong>
            <p style={{ margin: "var(--space-2) 0 0", fontSize: "var(--text-sm)" }}>
              Lifts gently, like a cat noticing an open lap.
            </p>
          </Card>
          <Card flat padding="var(--space-4)" style={{ width: 240 }}>
            <strong style={{ fontFamily: "var(--font-display)", color: "var(--text-strong)" }}>
              Flat card
            </strong>
            <p style={{ margin: "var(--space-2) 0 0", fontSize: "var(--text-sm)" }}>
              Border only, custom padding.
            </p>
          </Card>
        </Section>

        <Section title="CatCard">
          <CatCard
            name="Baklava"
            catId="SYR-0142"
            neighborhood="Vaporia"
            status="Desexed"
            statusTone="success"
            tags={[
              { label: "Friendly", tone: "bougain" },
              { label: "Regular", tone: "aegean" },
            ]}
          />
          <CatCard
            name="Πορτοκάλης"
            catId="SYR-0007"
            neighborhood="Ano Syros"
            status="Needs care"
            statusTone="danger"
            tags={[{ label: "Shy", tone: "neutral" }, { label: "Kitten", tone: "sun" }]}
          />
        </Section>

        <Section title="StatTile">
          <StatTile value="142" label="Cats catalogued" icon="🐱" tone="aegean" />
          <StatTile value="38" label="Spotters" icon="🐾" tone="bougain" />
          <StatTile value="97%" label="Desexed goal" icon="✅" tone="olive" />
          <StatTile value="€1.2k" label="Vet fund" icon="☀️" tone="sun" />
        </Section>

        <Section title="ProgressBar">
          <div style={{ width: 320, display: "grid", gap: "var(--space-3)" }}>
            <ProgressBar value={64} label="Vet fund goal" tone="aegean" />
            <ProgressBar value={142} max={200} label="Cats catalogued" tone="bougain" />
            <ProgressBar value={97} label="Desexing drive" tone="olive" />
          </div>
        </Section>

        <Section title="Avatar">
          <Avatar name="Katerina" size="sm" />
          <Avatar name="Marios" />
          <Avatar name="Eleni" size="lg" ring />
          <Avatar name="Baklava" size="xl" ring />
        </Section>

        <Section title="TabBar">
          <TabBar
            inline
            items={[
              { key: "spot", label: "Spot", icon: "📍" },
              { key: "cats", label: "Cats", icon: "🐱" },
              { key: "board", label: "Board", icon: "🏆" },
              { key: "me", label: "Me", icon: "🐾" },
            ]}
            active={tab}
            onChange={setTab}
          />
        </Section>
      </div>
    </div>
  );
}
