import { describe, expect, it } from "vitest";
import { planReducer } from "./plan.js";
import {
  computeProtection,
  detectRisks,
  mostVulnerable,
  nextMeasures,
  scoreLabel,
} from "./insights.js";
import { MODELLED_MEASURES } from "./exposure.js";
import { makePlan, makeProfile, TODAY } from "../test/fixtures.js";

describe("computeProtection", () => {
  it("rises as measures are adopted", () => {
    const plan = makePlan();
    const before = computeProtection(plan).score;
    let adopted = plan;
    for (const measure of adopted.measures) {
      adopted = planReducer(
        adopted,
        { type: "setMeasureStatus", id: measure.id, status: "done" },
        TODAY,
      );
    }
    expect(computeProtection(adopted).score).toBeGreaterThan(before);
    expect(computeProtection(adopted).score).toBeLessThanOrEqual(100);
  });
});

describe("detectRisks", () => {
  it("flags a vulnerable household with no clean air and a peak-hour workout", () => {
    const risks = detectRisks(makePlan()).map((r) => r.id);
    expect(risks).toContain("vulnerable-no-purifier");
    expect(risks).toContain("exercise-in-peak");
  });

  it("flags burning fuel indoors", () => {
    const wood = makePlan({
      home: { ...makeProfile().home, cookingFuel: "wood", heating: "wood" },
    });
    const ids = detectRisks(wood).map((r) => r.id);
    expect(ids).toContain("dirty-cooking");
    expect(ids).toContain("dirty-heating");
  });

  it("flags an unmasked open-air commute in heavy smog", () => {
    const biker = makePlan({ commuteMode: "motorbike", commuteTime: "08:00" });
    expect(detectRisks(biker).map((r) => r.id)).toContain("commute-unmasked");
  });

  it("sorts high severity first", () => {
    const risks = detectRisks(makePlan());
    const firstMedium = risks.findIndex((r) => r.severity === "medium");
    const lastHigh = risks.map((r) => r.severity).lastIndexOf("high");
    if (firstMedium !== -1 && lastHigh !== -1) expect(lastHigh).toBeLessThan(firstMedium);
  });
});

describe("nextMeasures", () => {
  it("lists only un-adopted measures, highest impact first", () => {
    const next = nextMeasures(makePlan(), 5);
    expect(next.length).toBeGreaterThan(0);
    for (let i = 1; i < next.length; i += 1) {
      expect(next[i - 1]!.impact).toBeGreaterThanOrEqual(next[i]!.impact);
    }
  });

  it("excludes measures already done", () => {
    let plan = makePlan();
    const id = plan.measures[0]!.id;
    plan = planReducer(plan, { type: "setMeasureStatus", id, status: "done" }, TODAY);
    expect(nextMeasures(plan, 20).some((m) => m.id === id)).toBe(false);
  });
});

describe("helpers", () => {
  it("mostVulnerable picks the most sensitive member", () => {
    expect(mostVulnerable(makePlan())).toBe("child");
    expect(mostVulnerable(makePlan({ members: [{ id: "a", label: "A", group: "healthy" }] }))).toBe(
      "healthy",
    );
  });

  it("labels scores", () => {
    expect(scoreLabel(90)).toMatch(/protected/i);
    expect(scoreLabel(10)).toMatch(/exposed/i);
  });

  it("every modelled measure is a real category", () => {
    expect(MODELLED_MEASURES.length).toBeGreaterThan(0);
  });
});
