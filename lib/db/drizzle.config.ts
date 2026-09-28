import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Generated migrations, reviewed in the pull request and committed. Applied
  // by `pnpm run migrate` (src/migrate), never by `drizzle-kit push`.
  // Relative on purpose: drizzle-kit prefixes "./" to `out`, which breaks an
  // absolute path once a snapshot exists. Scripts run from lib/db.
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
