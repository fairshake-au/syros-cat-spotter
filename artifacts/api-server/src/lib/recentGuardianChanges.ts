import { sql } from "drizzle-orm";
import { coloniesTable, db, peopleTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { listGuardianChanges } from "./guardianChanges";

// "Recent guardian changes" at the top of the team's Colonies page (SYC-209
// PR 4.3; feeding-sites spec §2.6; plan K6). The last twenty things cat
// guardians did: colonies created, sites added or moved, cats put in or
// taken out. Each names the cat guardian, the day and the colony.
//
// Island-only and team-only: the route checks `view_guardian_changes`
// before it calls this, and nothing here reaches a cat guardian's pages.
//
// Built from two sources:
// - roles PR 2.2's `listGuardianChanges()`: the colonies she created, and
//   her `colony` statements (a cat put in, or taken out), which carry
//   `roleAtTime = guardian` and the colony that granted them;
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

/** The list, newest first, at most twenty. A fixed number of queries. */
export async function recentGuardianChanges(
  limit: number = RECENT_GUARDIAN_CHANGES,
): Promise<RecentGuardianChange[]> {
  const [changes, sites] = await Promise.all([listGuardianChanges(), guardianSiteEvents(limit)]);

  const out: RecentGuardianChange[] = [];
  for (const c of changes) {
    if (c.type === "colony_created") {
      out.push({
        kind: "colony_created",
        at: c.at,
        guardian: c.guardian,
        colony: { id: c.colonyId, name: c.colony?.name ?? null },
      });
    } else if (c.type === "statement" && c.kind === "colony" && c.colonyId !== null) {
      const into = (c.value as { colonyId?: unknown } | null)?.colonyId;
      out.push({
        kind: into === null ? "cat_taken_out" : "cat_added",
        at: c.at,
        guardian: c.guardian,
        colony: { id: c.colonyId, name: null },
        cat: c.cat,
      });
    }
  }

  const siteIds = [...new Set(sites.map((s) => s.person_id))];
  const people =
    siteIds.length === 0
      ? []
      : await db
          .select({ id: peopleTable.id, name: peopleTable.name, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(inArray(peopleTable.id, siteIds));
  const personById = new Map(people.map((p) => [p.id, { id: p.id, name: p.name, left: p.leftAt !== null }]));
  for (const s of sites) {
    out.push({
      kind: s.kind === "created" ? "site_added" : "site_moved",
      at: new Date(s.at).toISOString(),
      guardian: personById.get(s.person_id) ?? null,
      colony: { id: Number(s.colony_id), name: null },
      site: { id: Number(s.site_id), name: s.site_name },
    });
  }

  out.sort((a, b) => b.at.localeCompare(a.at));
  const shown = out.slice(0, limit);

  // Every colony by its name today, in one query.
  const colonyIds = [...new Set(shown.map((c) => c.colony.id))];
  const colonies =
    colonyIds.length === 0
      ? []
      : await db
          .select({ id: coloniesTable.id, name: coloniesTable.name })
          .from(coloniesTable)
          .where(inArray(coloniesTable.id, colonyIds));
  const nameOf = new Map(colonies.map((c) => [c.id, c.name]));
  return shown.map((c) => ({ ...c, colony: { id: c.colony.id, name: nameOf.get(c.colony.id) ?? null } }));
}
