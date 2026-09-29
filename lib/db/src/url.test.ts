import { describe, expect, it } from "vitest";
import { describeHost, resolveDatabaseUrl } from "./url";

const neonProd =
  "postgresql://u:p@ep-prod-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full";
const neonDev =
  "postgresql://u:p@ep-dev.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full";
const replit = "postgresql://u:p@helium/heliumdb";

describe("resolveDatabaseUrl", () => {
  it("production uses APP_DATABASE_URL", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "production",
        APP_DATABASE_URL: neonProd,
        DATABASE_URL: replit,
      }),
    ).toEqual({ url: neonProd, source: "APP_DATABASE_URL" });
  });
  it("production refuses to fall back to DATABASE_URL", () => {
    expect(() =>
      resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: replit }),
    ).toThrow(/APP_DATABASE_URL must be set in production/);
  });
  it("production refuses a URL without sslmode", () => {
    expect(() =>
      resolveDatabaseUrl({
        NODE_ENV: "production",
        APP_DATABASE_URL: "postgresql://u:p@h/db",
      }),
    ).toThrow(/sslmode/);
  });
  it("a Replit workspace uses DEV_DATABASE_URL", () => {
    expect(
      resolveDatabaseUrl({
        REPL_ID: "x",
        DEV_DATABASE_URL: neonDev,
        DATABASE_URL: replit,
      }).source,
    ).toBe("DEV_DATABASE_URL");
  });
  it("a Replit workspace refuses Replit's own database", () => {
    expect(() =>
      resolveDatabaseUrl({ REPL_ID: "x", DATABASE_URL: replit }),
    ).toThrow(/DEV_DATABASE_URL/);
  });
  it("CI and local use DATABASE_URL", () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/t",
      }).source,
    ).toBe("DATABASE_URL");
  });
  it("errors never contain the password", () => {
    expect(() =>
      resolveDatabaseUrl({
        NODE_ENV: "production",
        APP_DATABASE_URL: "postgresql://u:secretpw@h/db",
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("secretpw"),
      }),
    );
  });
  it("describeHost shows the host only", () => {
    expect(describeHost(neonProd)).toBe(
      "ep-prod-pooler.eu-central-1.aws.neon.tech",
    );
  });
});
