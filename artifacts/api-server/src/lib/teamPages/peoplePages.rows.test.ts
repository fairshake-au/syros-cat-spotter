import { describe, expect, it } from "vitest";
import { renderPeoplePage } from "./peoplePages";
import { shortRolesOf, type PersonView } from "../people/screen";

const base = { viewer: "Sam", tab: "people" as const, people: [], left: [], colonies: [], done: null };
const recentPerson = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ann",
  email: "a@example.com",
  anonymised: false,
  state: "joined",
  chip: "Joined",
  roles: "A member of the Syros Cats team",
  shortRoles: "Team",
  placements: [],
  timing: "",
  holdsWorkspace: false,
  joinedAt: new Date(),
  history: [],
  isSelf: false,
  starting: false,
} as PersonView;

describe("Joined in the last 7 days (SYC-619 §4.1)", () => {
  it("is left out when nobody has joined", () => {
    expect(renderPeoplePage({ ...base, recent: [] })).not.toContain("Joined in the last 7 days");
  });
  it("is shown, linking to ?open=, when someone has", () => {
    const html = renderPeoplePage({ ...base, recent: [recentPerson] });
    expect(html).toContain("Joined in the last 7 days");
    expect(html).toContain(`?open=${recentPerson.id}#p-${recentPerson.id}`);
  });
});

describe("shortRolesOf", () => {
  it("lets management win over team and adds the guardian", () => {
    expect(shortRolesOf(["management", "guardian"])).toBe("Management, cat guardian");
    expect(shortRolesOf(["staff", "management"])).toBe("Management");
    expect(shortRolesOf(["staff", "guardian"])).toBe("Team, cat guardian");
    expect(shortRolesOf(["guardian"])).toBe("Cat guardian");
    expect(shortRolesOf([])).toBe("");
  });
});
