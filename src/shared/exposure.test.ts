import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildAirQuality } from "./aqi.js";
import {
  adoptedCategories,
  cigarettes,
  computeSegments,
  DOSE_PER_CIGARETTE,
  exposureSummary,
  formatDose,
  measureImpact,
  MODELLED_MEASURES,
  planExposure,
  TARGET_DOSE,
} from "./exposure.js";
import type { AirQuality, Home, MeasureCategory, Profile } from "./schemas.js";
import { makePlan, makeProfile } from "../test/fixtures.js";

const air: AirQuality = buildAirQuality({ city: "Delhi", source: "model", observedAt: "x" });
const profile: Profile = makeProfile();
const home: Home = profile.home;

describe("computeSegments", () => {
  it("spans roughly a full day and never breathes negative air", () => {
    const segments = computeSegments(profile, home, air, new Set());
    const hours = segments.reduce((sum, s) => sum + s.hours, 0);
    expect(hours).toBeGreaterThan(20);
    expect(hours).toBeLessThanOrEqual(25);
    for (const s of segments) expect(s.effectivePm25).toBeGreaterThanOrEqual(0);
  });

  it("a mask cuts the outdoor segments' dose", () => {
    const bare = computeSegments(profile, home, air, new Set());
    const masked = computeSegments(profile, home, air, new Set<MeasureCategory>(["masks"]));
    const outdoorBare = bare.filter((s) => s.place === "outdoor").reduce((a, s) => a + s.dose, 0);
    const outdoorMasked = masked
      .filter((s) => s.place === "outdoor")
      .reduce((a, s) => a + s.dose, 0);
    expect(outdoorMasked).toBeLessThan(outdoorBare);
  });

  it("moving exercise indoors reclassifies the segment", () => {
    const outside = computeSegments(profile, home, air, new Set());
    const inside = computeSegments(profile, home, air, new Set<MeasureCategory>(["exercise"]));
    expect(outside.find((s) => s.id === "outdoor")?.place).toBe("outdoor");
    expect(inside.find((s) => s.id === "outdoor")?.place).toBe("indoor");
  });
});

describe("exposureSummary", () => {
  it("orders doing-nothing >= now >= fully-protected", () => {
    const summary = exposureSummary({ profile, home, air, adopted: new Set() });
    expect(summary.baselineDose).toBeGreaterThanOrEqual(summary.totalDose);
    expect(summary.totalDose).toBeGreaterThanOrEqual(summary.protectedDose);
    expect(summary.targetDose).toBe(TARGET_DOSE);
  });

  it("flags Delhi smog as far over the safe target", () => {
    const summary = exposureSummary({ profile, home, air, adopted: new Set() });
    expect(summary.over).toBe(true);
    expect(summary.timesTarget).toBeGreaterThan(1);
    expect(summary.cigarettesEquivalent).toBeGreaterThan(0);
  });

  it("adopting every measure lowers the total to the protected floor", () => {
    const all = exposureSummary({ profile, home, air, adopted: new Set(MODELLED_MEASURES) });
    expect(all.totalDose).toBe(all.protectedDose);
    expect(all.reductionAchieved).toBe(all.reductionPossible);
  });
});

describe("measureImpact", () => {
  it("is non-negative for every category and zero for monitoring", () => {
    for (const category of MODELLED_MEASURES) {
      expect(measureImpact(category, { profile, home, air })).toBeGreaterThanOrEqual(0);
    }
    expect(measureImpact("monitoring", { profile, home, air })).toBe(0);
  });

  it("any single measure from the baseline never raises the dose (property)", () => {
    const categories: MeasureCategory[] = [...MODELLED_MEASURES];
    const baseline = exposureSummary({ profile, home, air, adopted: new Set() }).totalDose;
    fc.assert(
      fc.property(fc.constantFrom(...categories), (category) => {
        const withOne = exposureSummary({
          profile,
          home,
          air,
          adopted: new Set([category]),
        }).totalDose;
        expect(withOne).toBeLessThanOrEqual(baseline + 1);
      }),
    );
  });
});

describe("plan helpers and formatting", () => {
  it("reads adopted categories from done measures", () => {
    const plan = makePlan();
    const adopted = adoptedCategories(plan);
    // The seed marks nothing done by default (no purifier), so the set is empty.
    expect(adopted.size).toBe(plan.measures.filter((m) => m.status === "done").length);
  });

  it("planExposure matches a direct summary", () => {
    const plan = makePlan();
    const direct = exposureSummary({
      profile: plan.profile,
      home: plan.profile.home,
      air: plan.air,
      adopted: adoptedCategories(plan),
    });
    expect(planExposure(plan).totalDose).toBe(direct.totalDose);
  });

  it("formats a dose and a cigarette count", () => {
    expect(formatDose(1234)).toMatch(/1,234/);
    expect(cigarettes(DOSE_PER_CIGARETTE)).toBe(1);
  });
});
