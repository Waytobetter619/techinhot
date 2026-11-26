import { assertProductionSecrets, config } from "@techinhot/backend/config";
import { closeDb } from "@techinhot/backend/db";
import { installModules } from "@techinhot/backend/modules";
import { SERVER_MODULES } from "@techinhot/site/modules/server";
import { ADMIN, DEPLOYMENT } from "@techinhot/site";
import { startHeartbeat } from "@techinhot/backend/operations/heartbeat";
import { startWorkerWatchdog } from "@techinhot/backend/operations/watch";
import { buildApp } from "./app.ts";

installModules(SERVER_MODULES);
assertProductionSecrets([
  ["auth", "SESSION_SECRET"],
  ["auth", "IMG_PROXY_SIGN_SECRET"],
  ...DEPLOYMENT.requiredSecrets,
]);
// A site with admin pages needs a usable password.
if (config.environmentName === "production" && ADMIN && !(config.adminPassword && config.adminPassword.length >= 12)) {
  throw new Error("Refusing to start in production: set ADMIN_PASSWORD (at least 12 characters)");
}

const app = await buildApp();
await app.listen({ port: config.apiPort, host: process.env.API_HOST || "127.0.0.1" });
startHeartbeat(`api:${config.apiPort}`);
startWorkerWatchdog();

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
