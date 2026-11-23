import { describe, expect, it } from "vitest";
import { aiContracts } from "./contracts.js";
import { planProposalSchema } from "./schemas.js";

describe("model output is parsed leniently where a gap is harmless", () => {
  // Observed from a real model: unknown enum fields came back as "", which used
  // to fail validation and throw away an otherwise good answer.
  it("treats empty or unknown profile fields as absent and keeps the rest", () => {
    const result = aiContracts.interpret.output.safeParse({
      profile: {
        city: "Delhi",
        home: { ventilation: "", heating: null, cookingFuel: "lpg", nearRoad: true },
        outdoorActivity: "",
        commuteMode: "cycle",
        concerns: ["children", "health", "commute"],
        members: [{ label: "Son", group: "asthmatic" }],
      },
      assumptions: [],
      questions: [],
      reasoning: "read it",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const { profile } = result.data;
    expect(profile.city).toBe("Delhi");
    expect(profile.home?.ventilation).toBeUndefined();
    expect(profile.home?.heating).toBeUndefined();
    expect(profile.home?.cookingFuel).toBe("lpg");
    expect(profile.outdoorActivity).toBeUndefined();
    expect(profile.commuteMode).toBe("cycle");
    expect(profile.concerns).toEqual(["children", "commute"]);
    expect(profile.members?.[0]?.group).toBe("healthy");
  });

  it("still rejects an answer missing what the user needs to see", () => {
    const result = aiContracts.interpret.output.safeParse({
      profile: {},
      assumptions: [],
      questions: [],
    });
    expect(result.success).toBe(false);
  });

  it("maps an empty measure category to 'none fits'", () => {
    const personalize = aiContracts.personalize.output.parse({
      summary: "s",
      measures: [{ label: "Seal the balcony door", category: "", why: "w" }],
      routine: [],
      reasoning: "r",
    });
    expect(personalize.measures[0]?.category).toBeNull();

    const proposal = planProposalSchema.parse({
      type: "addMeasure",
      label: "x",
      category: "bogus",
      why: "w",
    });
    expect(proposal.type === "addMeasure" && proposal.category).toBeNull();
  });
});
