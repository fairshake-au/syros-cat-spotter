import { beforeEach, describe, expect, it, vi } from "vitest";

const randomIntMock = vi.hoisted(() => ({ value: undefined as number | undefined }));

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    randomInt: ((...args: unknown[]) =>
      randomIntMock.value !== undefined
        ? randomIntMock.value
        : (real.randomInt as (...a: unknown[]) => number)(...args)) as typeof real.randomInt,
  };
});

import { RESTORE_CODE_DIGITS, RESTORE_CODE_TRIES, codeHash, isCodeShaped, newCode } from "./tokens";

describe("restore code helpers", () => {
  beforeEach(() => {
    randomIntMock.value = undefined;
    process.env["EMAIL_FINGERPRINT_KEY"] = "k".repeat(40);
  });

  it("has the agreed sizes", () => {
    expect(RESTORE_CODE_DIGITS).toBe(8);
    expect(RESTORE_CODE_TRIES).toBe(5);
  });

  it("newCode is always 8 digits", () => {
    for (let i = 0; i < 1000; i++) expect(newCode()).toMatch(/^\d{8}$/);
  });

  it("newCode keeps leading zeros", () => {
    randomIntMock.value = 42;
    expect(newCode()).toBe("00000042");
  });

  it("codeHash depends on the token row and the code", () => {
    expect(codeHash("a", "12345678")).not.toBe(codeHash("b", "12345678"));
    expect(codeHash("a", "12345678")).not.toBe(codeHash("a", "12345679"));
    expect(codeHash("a", "12345678")).toBe(codeHash("a", "12345678"));
  });

  it("isCodeShaped takes digits only", () => {
    expect(isCodeShaped("48291376")).toBe(true);
    expect(isCodeShaped("4829 1376")).toBe(false);
    expect(isCodeShaped("4829137")).toBe(false);
    expect(isCodeShaped("482913765")).toBe(false);
    expect(isCodeShaped(48291376)).toBe(false);
    expect(isCodeShaped(undefined)).toBe(false);
  });
});
