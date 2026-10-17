import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  catsTable,
  coloniesTable,
  db,
  observationsTable,
  peopleTable,
  personEventsTable,
} from "@workspace/db";

// "Recent guardian changes" at the top of the team's Colonies page (SYC-209
// PR 4.3; feeding-sites spec §2.6; plan K6). The last twenty things cat
// guardians did: colonies created, sites added or moved, cats put in or
// taken out. Each names the cat guardian, the day and the colony.
//
// Island-only and team-only: the route checks `view_guardian_changes`
// before it calls this, and nothing here reaches a cat guardian's pages.
//
// Built from the same records as roles PR 2.2's `listGuardianChanges()`
// (lib/guardianChanges.ts), read narrowly here:
// - the colonies she created (`roles_changed` with `createdColony`, written
//   by her about herself), and her `colony` statements (a cat put in, or
//   taken out), which carry `roleAtTime = guardian` and the colony that
//   granted them. `listGuardianChanges()` itself takes the newest 200
//   statements of EVERY kind, so a burst of sterilisation or coat statements
//   would push cats off this list (review M1); it also works out
//   disagreements this list doesn't show. So each source is read here with
//   its own kind filter and limit;
// - this plan's history rows (`mapping_events`) for sites added or moved.
//   Those rows don't record the writer's role, so a site row counts as a
//   cat guardian's when its writer has a guardian placement (in force or
//   ended; colony placements are never deleted) on the site's colony, and
//   holds no island-wide placement now. A team member who is also a cat
//   guardian acts as the team, as `actingRole` decides.

export const RECENT_GUARDIAN_CHANGES = 20;

export type RecentChangeKind =
  | "colony_created"
  | "site_added"
  | "site_moved"
  | "cat_added"
  | "cat_taken_out";

export interface RecentGuardianChange {
  kind: RecentChangeKind;
  /** When (ISO). */
  at: string;
  guardian: { id: string; name: string; left: boolean } | null;
  colony: { id: number; name: string | null };
  /** The site, for a site row. Never its position. */
  site?: { id: number; name: string };
  /** The cat, for a cat row. */
  cat?: { id: number; name: string };
}

interface SiteRow {
  [key: string]: unknown;
  kind: "created" | "moved";
  at: Date | string;
  person_id: string;
  site_id: number;
  site_name: string;
  colony_id: number;
}

/** Sites added or moved by a cat guardian, newest first. */
async function guardianSiteEvents(limit: number): Promise<SiteRow[]> {
  const result = await db.execute<SiteRow>(sql`
    with e as (
      select ev.id, ev.kind, ev.at, ev.person_id, s.id as site_id, s.name as site_name,
             coalesce(
               case when ev.after ->> 'colonyId' ~ '^[0-9]{1,9}$' then (ev.after ->> 'colonyId')::int end,
               s.colony_id
             ) as colony_id
      from mapping_events ev
      join feeding_sites s on s.id = ev.subject_id
      where ev.subject_kind = 'site'
        and ev.kind in ('created', 'moved')
        and ev.person_id is not null
    )
    select e.kind, e.at, e.person_id, e.site_id, e.site_name, e.colony_id
    from e
    where e.colony_id is not null
      and exists (
        select 1 from person_scopes g
        where g.person_id = e.person_id and g.role = 'guardian' and g.colony_id = e.colony_id
      )
      and not exists (
        select 1 from person_scopes i
        where i.person_id = e.person_id and i.reach = 'island'
          and (i.expires_at is null or i.expires_at > now())
      )
    order by e.at desc, e.id desc
    limit ${limit}
  `);
  return result.rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The colony that granted a statement, from `colony:<id>`. */
const colonyOfScope = (scope: string | null): number | null => {
  const m = /^colony:([1-9][0-9]{0,8})$/.exec(scope ?? "");
  return m ? Number(m[1]) : null;
};

type Pending = RecentGuardianChange & { personId: string | null };

/** The list, newest first, at most twenty. Six queries, whatever the count. */
export async function recentGuardianChanges(
  limit: number = RECENT_GUARDIAN_CHANGES,
): Promise<RecentGuardianChange[]> {
  const [statements, created, sites] = await Promise.all([
    // Her cats put in or taken out, newest first (the partial index from
    // migration 0030 serves the guardian rows in this order).
    db
      .select({
        at: observationsTable.createdAt,
        catId: observationsTable.catId,
        value: observationsTable.value,
        accountId: observationsTable.accountId,
        authorityScope: observationsTable.authorityScope,
      })
      .from(observationsTable)
      .where(and(eq(observationsTable.roleAtTime, "guardian"), eq(observationsTable.kind, "colony")))
      .orderBy(desc(observationsTable.createdAt), desc(observationsTable.id))
      .limit(limit),
    // Colonies she created: her own `roles_changed` naming the new colony.
    db
      .select({ personId: personEventsTable.personId, at: personEventsTable.at, detail: personEventsTable.detail })
      .from(personEventsTable)
      .where(
        and(
          eq(personEventsTable.kind, "roles_changed"),
          sql`${personEventsTable.by} = ${personEventsTable.personId}::text`,
          isNotNull(sql`${personEventsTable.detail} -> 'createdColony'`),
        ),
      )
      .orderBy(desc(personEventsTable.at), desc(personEventsTable.id))
      .limit(limit),
    guardianSiteEvents(limit),
  ]);

  const out: Pending[] = [];
  for (const c of created) {
    const colonyId = (c.detail as { createdColony?: unknown } | null)?.createdColony;
    if (typeof colonyId !== "number") continue;
    out.push({
      kind: "colony_created",
      at: c.at.toISOString(),
      personId: c.personId,
      guardian: null,
      colony: { id: colonyId, name: null },
    });
  }
  for (const st of statements) {
    const colonyId = colonyOfScope(st.authorityScope);
    const into = (st.value as { colonyId?: unknown } | null)?.colonyId;
    // Only a value that says where the cat went: a colony (put in) or none
    // (taken out). Anything else is not one of these changes (review m3).
    if (colonyId === null || !(into === null || typeof into === "number")) continue;
    out.push({
      kind: into === null ? "cat_taken_out" : "cat_added",
      at: st.at.toISOString(),
      personId: st.accountId,
      guardian: null,
      colony: { id: colonyId, name: null },
      cat: { id: st.catId, name: "" },
    });
  }
  for (const s of sites) {
    out.push({
      kind: s.kind === "created" ? "site_added" : "site_moved",
      at: new Date(s.at).toISOString(),
      personId: s.person_id,
      guardian: null,
      colony: { id: Number(s.colony_id), name: null },
      site: { id: Number(s.site_id), name: s.site_name },
    });
  }

  out.sort((a, b) => b.at.localeCompare(a.at));
  const shown = out.slice(0, limit);

  // Every colony, cat and person by name, one query each.
  const colonyIds = [...new Set(shown.map((c) => c.colony.id))];
  const catIds = [...new Set(shown.flatMap((c) => (c.cat ? [c.cat.id] : [])))];
  const personIds = [
    ...new Set(shown.map((c) => c.personId).filter((id): id is string => typeof id === "string" && UUID.test(id))),
  ];
  const [colonies, cats, people] = await Promise.all([
    colonyIds.length === 0
      ? []
      : db
          .select({ id: coloniesTable.id, name: coloniesTable.name })
          .from(coloniesTable)
          .where(inArray(coloniesTable.id, colonyIds)),
    catIds.length === 0
      ? []
      : db.select({ id: catsTable.id, name: catsTable.name }).from(catsTable).where(inArray(catsTable.id, catIds)),
    personIds.length === 0
      ? []
      : db
          .select({ id: peopleTable.id, name: peopleTable.name, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(inArray(peopleTable.id, personIds)),
  ]);
  const colonyName = new Map(colonies.map((c) => [c.id, c.name]));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const person = new Map(people.map((p) => [p.id, { id: p.id, name: p.name, left: p.leftAt !== null }]));
  return shown.map(({ personId, ...c }) => ({
    ...c,
    guardian: personId ? (person.get(personId) ?? null) : null,
    colony: { id: c.colony.id, name: colonyName.get(c.colony.id) ?? null },
    ...(c.cat ? { cat: { id: c.cat.id, name: catName.get(c.cat.id) ?? `#${c.cat.id}` } } : {}),
  }));
}
