import { describe, expect, it } from "vitest";
import { buildAirContext, buildPlanContext, profileForAi } from "./plan-context.js";
import { planContextSchema } from "./contracts.js";
import { makePlan, TODAY } from "../test/fixtures.js";

describe("buildAirContext", () => {
  it("summarises the air without the full hourly curve", () => {
    const air = buildAirContext(makePlan().air);
    expect(air.aqi).toBeGreaterThan(0);
    expect(air.level.length).toBeGreaterThan(0);
    expect(air.cleanestFrom).toMatch(/^\d\d:00$/);
    expect(air.peakHours).toBeGreaterThanOrEqual(0);
  });
});

describe("buildPlanContext", () => {
  const context = buildPlanContext(makePlan(), TODAY);

  it("is schema-valid", () => {
    expect(planContextSchema.safeParse(context).success).toBe(true);
  });

  it("carries member groups but never their names (privacy)", () => {
    const names = makePlan().profile.members.map((m) => m.label);
    const serialised = JSON.stringify(context);
    for (const name of names) {
      if (name !== "Me") expect(serialised).not.toContain(name);
    }
    expect(context.memberGroups).toContain("child");
    expect(context.mostVulnerable).toBe("child");
  });

  it("includes the exposure numbers and the risks", () => {
    expect(context.exposureNow).toBeGreaterThan(0);
    expect(context.exposureBaseline).toBeGreaterThanOrEqual(context.exposureNow);
    expect(context.measures.length).toBeGreaterThan(0);
    expect(Array.isArray(context.risks)).toBe(true);
  });
});

describe("profileForAi", () => {
  it("replaces every member's name with their group, keeping who is vulnerable", () => {
    const profile = makePlan().profile;
    const redacted = profileForAi(profile);
    const serialised = JSON.stringify(redacted.members);
    for (const member of profile.members) {
      if (member.label !== "Me") expect(serialised).not.toContain(member.label);
    }
    expect(redacted.members.map((m) => m.group)).toEqual(profile.members.map((m) => m.group));
    expect(redacted.members.map((m) => m.label)).toEqual(["Adult", "Child", "Older adult"]);
  });

  it("numbers repeated groups so they stay distinct", () => {
    const profile = makePlan({
      members: [
        { id: "a", label: "Riya", group: "child" },
        { id: "b", label: "Kabir", group: "child" },
      ],
    }).profile;
    expect(profileForAi(profile).members.map((m) => m.label)).toEqual(["Child", "Child 2"]);
  });
});
