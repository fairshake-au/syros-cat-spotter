import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STARTER_FACT_IDS } from "@workspace/db";
import { FACT_WORDS } from "./appSwitchFacts";

// SYC-383: the page's English words are a copy of the app's. They must not drift.
describe("the App switches page's fact words", () => {
  const i18n = fs.readFileSync(path.join(__dirname, "../../../../cat-spotter/lib/i18n.ts"), "utf8");

  it("lists the twenty facts in the same order as the server's ids", () => {
    expect(FACT_WORDS.map((f) => f.id)).toEqual([...STARTER_FACT_IDS]);
  });

  it.each(FACT_WORDS.map((f) => [f.id, f.text]))("%s reads the same as the app's English", (id, text) => {
    const m = i18n.match(new RegExp(`'${id!.replace(".", "\\.")}': (["'])(.*?)\\1,\\n`));
    expect(m, `${id} not found in i18n.ts`).not.toBeNull();
    expect(text).toBe(m![2]);
  });
});
