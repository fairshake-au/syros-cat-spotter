import { databaseTarget, pool } from "@workspace/db";
import app from "./app";
import { logDatabaseTarget } from "./lib/databaseStartup";
import { logger } from "./lib/logger";
import { describeGate } from "./lib/prelaunch";
import { describeMail } from "./lib/mail/send";
import { assertBlurConfigured, describeBlur } from "./lib/blur";

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
// SYC-42: say whether the mail key is present (never its value).
for (const { level, line } of describeMail()) logger[level](line);
// SYC-41 (data spine PR 6): refuse to start in production without the blur
// grid secret, rather than publish cat positions on the public grid.
assertBlurConfigured();
logger.info(describeBlur());

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // SYC-121: never blocks start-up (see databaseStartup.ts).
  void logDatabaseTarget(pool, databaseTarget, logger);
});
