// Imports sources from a JSON file outside the repository: a site's own source list that should not be
// published with the code. Same shape and rules as industry/sources.json (only ids not there yet are added,
// so admin edits are never undone). Re-runnable:  node --env-file=.env scripts/import-sources.ts <file.json>
import { readFileSync } from "node:fs";
import { closeDb, sql } from "@aihot/backend/db";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";

interface ImportSource {
  id: string;
  name: string;
  kind: "rss" | "web_list" | "json_list" | "x_search" | "mp_account" | "external";
  config: Record<string, unknown>;
  tier?: string;
  owner_entity_id?: string | null;
  participation_mode?: string;
  interval_minutes?: number;
  tags?: string[];
  site_fulltext?: boolean;
  syndicate_fulltext?: boolean;
  enabled?: boolean;
}

const file = process.argv[2];
if (!file) throw new Error("usage: node --env-file=.env scripts/import-sources.ts <file.json>");
const { sources } = JSON.parse(readFileSync(file, "utf8")) as { sources: ImportSource[] };
let added = 0;
for (const s of sources) {
  assertSupportedConfig(s.kind, s.config);
  const tier = s.tier ?? "T2";
  const inserted = await sql`
    INSERT INTO sources (id, name, kind, config, tier, first_party, owner_entity_id, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, enabled, next_fetch_at)
    VALUES (${s.id}, ${s.name}, ${s.kind}, ${sql.json(s.config as never)}, ${tier}, ${tier === "T1"}, ${s.owner_entity_id ?? null},
            ${s.participation_mode ?? "editorial"}, ${s.interval_minutes ?? 60}, ${s.tags ?? []}, ${s.site_fulltext ?? false}, ${s.syndicate_fulltext ?? false},
            ${s.enabled ?? true}, now())
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  added += inserted.length;
}
console.log(`sources: ${added} added, ${sources.length - added} already there`);
await closeDb();
