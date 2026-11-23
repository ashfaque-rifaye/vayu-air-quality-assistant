import { describe, expect, it } from "vitest";
import {
  inferCategory,
  MEASURE_SHORT_LABELS,
  MEASURE_TEMPLATES,
  measureChecklist,
  seedMeasures,
  SWAP_BANK,
} from "./knowledge.js";
import { MEASURE_CATEGORIES, measureSchema } from "./schemas.js";
import { makeProfile } from "../test/fixtures.js";

describe("measure catalogue", () => {
  it("covers every category with a short label and checklist", () => {
    for (const category of MEASURE_CATEGORIES) {
      expect(MEASURE_TEMPLATES[category].checklist.length).toBeGreaterThan(0);
      expect(MEASURE_SHORT_LABELS[category]).toBeTruthy();
      expect(measureChecklist(category)).toEqual([...MEASURE_TEMPLATES[category].checklist]);
    }
  });
});

describe("seedMeasures", () => {
  it("always seeds the core protections", () => {
    const measures = seedMeasures(makeProfile());
    const categories = measures.map((m) => m.category);
    expect(categories).toEqual(
      expect.arrayContaining(["purifier", "masks", "sealing", "ventilation", "monitoring"]),
    );
  });

  it("adds cooking and heating measures only when the fuel is dirty", () => {
    const dirty = seedMeasures(
      makeProfile({ home: { ...makeProfile().home, cookingFuel: "wood", heating: "wood" } }),
    ).map((m) => m.category);
    expect(dirty).toContain("cooking");
    expect(dirty).toContain("heating");

    const clean = seedMeasures(
      makeProfile({
        home: { ...makeProfile().home, cookingFuel: "induction", heating: "electric" },
      }),
    ).map((m) => m.category);
    expect(clean).not.toContain("cooking");
    expect(clean).not.toContain("heating");
  });

  it("marks an existing purifier as already done", () => {
    const measures = seedMeasures(
      makeProfile({ home: { ...makeProfile().home, hasPurifier: true } }),
    );
    expect(measures.find((m) => m.category === "purifier")?.status).toBe("done");
  });

  it("produces schema-valid measures", () => {
    for (const measure of seedMeasures(makeProfile())) {
      expect(measureSchema.safeParse(measure).success).toBe(true);
    }
  });
});

describe("swap bank", () => {
  it("has positive, concrete impact figures", () => {
    expect(SWAP_BANK.length).toBeGreaterThanOrEqual(4);
    for (const swap of SWAP_BANK) {
      expect(swap.co2eKgPerWeek).toBeGreaterThan(0);
      expect(swap.exposureReductionPerDay).toBeGreaterThanOrEqual(0);
      expect(swap.title.length).toBeGreaterThan(0);
    }
  });
});

describe("inferCategory", () => {
  it("labels free text by what it is about", () => {
    expect(inferCategory("Fit N95 mask before cycling")).toBe("masks");
    expect(inferCategory("Run the HEPA purifier on high")).toBe("purifier");
    expect(inferCategory("Keep windows shut during the clean window")).toBe("ventilation");
    expect(inferCategory("Run the chimney while cooking")).toBe("cooking");
    expect(inferCategory("Take the metro for the school run")).toBe("commute");
    expect(inferCategory("Yoga indoors instead of the park")).toBe("exercise");
    expect(inferCategory("Seal the gaps under the door")).toBe("sealing");
  });

  it("falls back to a general check", () => {
    expect(inferCategory("Morning symptom check for the child")).toBe("monitoring");
  });
});
