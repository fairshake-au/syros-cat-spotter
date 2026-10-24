import { describe, expect, it } from "vitest";
import { describeStatement } from "./teamCatView";

describe("describeStatement team_note", () => {
  it("says it is team only, in quotes, and leaves escaping to the renderer", () => {
    expect(describeStatement("team_note", { text: "limping <b>left</b>" })).toBe("Note (team only): “limping <b>left</b>”");
  });
  it("copes with a note whose text is missing", () => {
    expect(describeStatement("team_note", {})).toBe("Note (team only)");
  });
});
