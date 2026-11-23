import { describe, expect, it } from "vitest";
import { planReducer, type PlanAction } from "./plan.js";
import { planSchema, type Plan } from "./schemas.js";
import { makePlan, TODAY } from "../test/fixtures.js";

function reduce(plan: Plan, action: PlanAction, today = TODAY): Plan {
  return planReducer(plan, action, today);
}

describe("createPlan", () => {
  it("builds a complete, schema-valid plan", () => {
    const plan = makePlan();
    expect(planSchema.safeParse(plan).success).toBe(true);
    expect(plan.measures.length).toBeGreaterThan(0);
    expect(plan.routine.length).toBeGreaterThan(0);
    expect(plan.air.source).toBe("model");
  });
});

describe("profile and air", () => {
  it("rebuilds the modelled air when the city changes", () => {
    const plan = makePlan();
    const next = reduce(plan, { type: "updateProfile", patch: { city: "Bengaluru" } });
    expect(next.air.averagePm25).toBeLessThan(plan.air.averagePm25);
  });

  it("a manual average switches the source and reshapes the day", () => {
    const next = reduce(makePlan(), { type: "setAirAverage", amount: 90 });
    expect(next.air.source).toBe("manual");
    expect(next.air.averagePm25).toBe(90);
    const mean = next.air.hourly.reduce((a, b) => a + b, 0) / 24;
    expect(mean).toBeCloseTo(90, 0);
  });

  it("resetAir returns to the model", () => {
    const manual = reduce(makePlan(), { type: "setAirAverage", amount: 50 });
    expect(reduce(manual, { type: "resetAir" }).air.source).toBe("model");
  });

  it("ignores a negative manual average", () => {
    const plan = makePlan();
    expect(reduce(plan, { type: "setAirAverage", amount: -5 })).toBe(plan);
  });
});

describe("members", () => {
  it("adds, updates and removes members but keeps at least one", () => {
    let plan = makePlan({ members: [{ id: "m1", label: "Me", group: "healthy" }] });
    plan = reduce(plan, { type: "addMember", label: "Baby", group: "child" });
    expect(plan.profile.members).toHaveLength(2);
    plan = reduce(plan, {
      type: "updateMember",
      id: plan.profile.members[1]!.id,
      patch: { group: "respiratory" },
    });
    expect(plan.profile.members[1]!.group).toBe("respiratory");
    plan = reduce(plan, { type: "removeMember", id: plan.profile.members[1]!.id });
    expect(plan.profile.members).toHaveLength(1);
    // Cannot remove the last one.
    expect(
      reduce(plan, { type: "removeMember", id: plan.profile.members[0]!.id }).profile.members,
    ).toHaveLength(1);
  });
});

describe("measures", () => {
  it("changes status, adds, updates and removes", () => {
    let plan = makePlan();
    const first = plan.measures[0]!;
    plan = reduce(plan, { type: "setMeasureStatus", id: first.id, status: "done" });
    expect(plan.measures[0]!.status).toBe("done");

    plan = reduce(plan, {
      type: "addMeasure",
      label: "Buy a CO monitor",
      category: "monitoring",
      source: "you",
    });
    const added = plan.measures.at(-1)!;
    expect(added.checks.length).toBeGreaterThan(0);

    plan = reduce(plan, {
      type: "updateMeasure",
      id: added.id,
      patch: { notes: "under the stairs" },
    });
    expect(plan.measures.at(-1)!.notes).toBe("under the stairs");

    plan = reduce(plan, { type: "removeMeasure", id: added.id });
    expect(plan.measures.find((m) => m.id === added.id)).toBeUndefined();
  });

  it("toggles a checklist item and stores a guide", () => {
    let plan = makePlan();
    const measure = plan.measures[0]!;
    plan = reduce(plan, {
      type: "toggleMeasureCheck",
      measureId: measure.id,
      checkId: measure.checks[0]!.id,
    });
    expect(plan.measures[0]!.checks[0]!.done).toBe(true);
    plan = reduce(plan, {
      type: "setMeasureGuide",
      id: measure.id,
      guide: { whatToLookFor: ["HEPA"], redFlags: [], tip: "size it", reasoning: "r" },
    });
    expect(plan.measures[0]!.guide?.tip).toBe("size it");
  });
});

describe("routine, swaps and day-sheet", () => {
  it("regenerate keeps user items and rebuilds auto ones", () => {
    let plan = makePlan();
    plan = reduce(plan, {
      type: "addRoutineItem",
      time: "15:00",
      title: "School pickup, mask on",
      source: "you",
    });
    plan = reduce(plan, { type: "regenerateRoutine" });
    expect(plan.routine.some((i) => i.source === "you" && i.title.startsWith("School"))).toBe(true);
    expect(plan.routine.some((i) => i.source === "auto")).toBe(true);
  });

  it("setSwaps keeps saved swaps and replaces the rest", () => {
    let plan = makePlan();
    plan = reduce(plan, {
      type: "setSwaps",
      swaps: [
        {
          title: "Metro",
          description: "d",
          category: "Commute",
          co2eKgPerWeek: 10,
          exposureReductionPerDay: 100,
          why: "w",
        },
      ],
    });
    plan = reduce(plan, { type: "toggleSwapSaved", id: plan.swaps[0]!.id });
    plan = reduce(plan, {
      type: "setSwaps",
      swaps: [
        {
          title: "Induction",
          description: "d",
          category: "Cooking",
          co2eKgPerWeek: 5,
          exposureReductionPerDay: 200,
          why: "w",
        },
      ],
    });
    expect(plan.swaps.some((s) => s.title === "Metro" && s.saved)).toBe(true);
    expect(plan.swaps.some((s) => s.title === "Induction")).toBe(true);
  });

  it("stores a day-sheet", () => {
    const plan = reduce(makePlan(), {
      type: "setDaySheet",
      items: [{ time: "07:00", title: "Check air", note: "AQI high" }],
    });
    expect(plan.daySheet).toHaveLength(1);
  });
});

describe("the assistant proposes, the reducer disposes", () => {
  function withProposal(plan: Plan, proposal: Plan["chat"][number]["proposals"]): Plan {
    return reduce(plan, {
      type: "appendChat",
      message: { role: "assistant", text: "ok", proposals: proposal },
    });
  }

  it("applies a valid adoptMeasure and ignores an unknown id", () => {
    let plan = makePlan();
    const real = plan.measures[0]!.id;
    plan = withProposal(plan, [{ type: "adoptMeasure", measureId: real, why: "w" }]);
    const msgId = plan.chat.at(-1)!.id;
    plan = reduce(plan, { type: "applyProposal", messageId: msgId, index: 0 });
    expect(plan.measures.find((m) => m.id === real)!.status).toBe("done");

    let plan2 = withProposal(makePlan(), [{ type: "adoptMeasure", measureId: "ghost", why: "w" }]);
    const before = plan2.measures.map((m) => m.status);
    plan2 = reduce(plan2, { type: "applyProposal", messageId: plan2.chat.at(-1)!.id, index: 0 });
    expect(plan2.measures.map((m) => m.status)).toEqual(before);
  });

  it("applies addMeasure and addRoutineItem proposals, then dismisses", () => {
    let plan = makePlan();
    plan = withProposal(plan, [
      { type: "addMeasure", label: "Window film", category: "sealing", why: "w" },
      {
        type: "addRoutineItem",
        time: "20:00",
        title: "Shut the balcony door",
        why: "w",
        category: "sealing",
      },
    ]);
    const msgId = plan.chat.at(-1)!.id;
    const measuresBefore = plan.measures.length;
    plan = reduce(plan, { type: "applyProposal", messageId: msgId, index: 0 });
    expect(plan.measures.length).toBe(measuresBefore + 1);
    plan = reduce(plan, { type: "applyProposal", messageId: msgId, index: 0 });
    expect(plan.routine.find((i) => i.title === "Shut the balcony door")?.category).toBe("sealing");
    expect(plan.chat.at(-1)!.proposals).toHaveLength(0);
  });

  it("dismisses a proposal without applying it", () => {
    let plan = withProposal(makePlan(), [
      { type: "addMeasure", label: "Window film", category: "sealing", why: "w" },
    ]);
    const before = plan.measures.length;
    plan = reduce(plan, { type: "dismissProposal", messageId: plan.chat.at(-1)!.id, index: 0 });
    expect(plan.measures.length).toBe(before);
    expect(plan.chat.at(-1)!.proposals).toHaveLength(0);
  });
});

describe("applyPersonalization", () => {
  const payload = {
    summary: "Tailored for Delhi",
    reasoning: "crop burning",
    source: "gemini" as const,
    measures: [
      { label: "Walk the back lanes, not the ring road", category: null, why: "w" },
      // The plan already seeds masks and a commute measure for this household.
      { label: "N95 masks for the commute", category: "masks" as const, why: "w" },
      { label: "Take the metro", category: "commute" as const, why: "w" },
    ],
    routine: [
      {
        time: "08:00",
        title: "Delay the school run 30 min",
        why: "w",
        category: "commute" as const,
      },
    ],
  };

  it("adds new AI suggestions, categorised, and records the summary", () => {
    const plan = reduce(makePlan(), { type: "applyPersonalization", payload });
    expect(plan.personalization?.summary).toBe("Tailored for Delhi");
    expect(plan.measures.some((m) => m.label.startsWith("Walk the back lanes"))).toBe(true);
    expect(plan.routine.find((i) => i.source === "ai")?.category).toBe("commute");
  });

  it("skips suggestions that duplicate a measure the plan already has", () => {
    const before = makePlan();
    const plan = reduce(before, { type: "applyPersonalization", payload });
    expect(plan.measures.length).toBe(before.measures.length + 1);
    expect(plan.measures.filter((m) => m.category === "masks")).toHaveLength(1);
  });
});

describe("routine labelling", () => {
  it("labels a reminder by its title when it arrives as a general check", () => {
    let plan = reduce(makePlan(), {
      type: "addRoutineItem",
      time: "07:45",
      title: "Fit N95 mask before cycling",
      category: "monitoring",
      source: "ai",
    });
    plan = reduce(plan, { type: "addRoutineItem", time: "12:00", title: "Call grandma" });
    expect(plan.routine.find((i) => i.title.startsWith("Fit N95"))?.category).toBe("masks");
    expect(plan.routine.find((i) => i.title === "Call grandma")?.category).toBe("monitoring");
  });
});
