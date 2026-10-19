import { databaseTarget, pool } from "@workspace/db";
import app from "./app";
import { loadAreas } from "./lib/areas/namedAreas";
import { logDatabaseTarget } from "./lib/databaseStartup";
import { logger } from "./lib/logger";
import { describeGate } from "./lib/prelaunch";
import { describeTurnstile } from "./lib/turnstile";
import { describeMail } from "./lib/mail/send";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// SYC-113: say whether the pre-launch gate is on and which settings are
// present (never their values).
for (const line of describeGate()) logger.info(line);
for (const { level, line } of describeTurnstile()) logger[level](line);
// SYC-42: say whether the mail key is present (never its value).
for (const { level, line } of describeMail()) logger[level](line);

// SYC-396 PR 2.4: the named areas come from the database. Fill their cache
// before the first request, so place labels and filters use the team's list.
// A failure keeps SEED_AREAS and logs a warning; it never stops start-up.
await loadAreas();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // SYC-121: never blocks start-up (see databaseStartup.ts).
  void logDatabaseTarget(pool, databaseTarget, logger);
});
