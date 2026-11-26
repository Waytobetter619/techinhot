// Runs collection for given sources now (development / operations helper).
// node --env-file=.env scripts/collect.ts rss-openai-news rss-hugging-face ...
import { closeDb } from "@techinhot/backend/db";
import { stopBoss } from "@techinhot/backend/jobs/queue";
import { installModules } from "@techinhot/backend/modules";
import { collectSource } from "@techinhot/backend/sources/collect";
import { SERVER_MODULES } from "@techinhot/site/modules/server";

installModules(SERVER_MODULES);
try {
  for (const id of process.argv.slice(2)) {
    const started = performance.now();
    const r = await collectSource(id, { force: true });
    console.log(JSON.stringify({ ...r, ms: Math.round(performance.now() - started) }));
  }
} finally {
  await stopBoss();
  await closeDb();
}
