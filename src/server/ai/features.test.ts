import { describe, expect, it } from "vitest";
import { AI_FEATURE_NAMES } from "../../shared/contracts.js";
import { buildAirContext, buildPlanContext } from "../../shared/plan-context.js";
import { makePlan, makeProfile, TODAY } from "../../test/fixtures.js";
import { AI_FEATURES, suggestsOpeningUp } from "./features.js";

const ctx = { today: TODAY };

describe("every feature", () => {
  it("has a prompt, a fallback, and demands reasoning", () => {
    const profile = makeProfile();
    const air = buildAirContext(makePlan().air);
    const context = buildPlanContext(makePlan(), TODAY);
    const inputs: Record<string, unknown> = {
      interpret: { text: "help" },
      personalize: { profile, air },
      swaps: { profile, air, steer: "", exclude: [] },
      review: { context },
      measure: { profile, air, measureLabel: "Masks", category: "masks" },
      daysheet: { profile, air, wakeTime: "07:00" },
      chat: { context, history: [], message: "hi" },
    };
    for (const name of AI_FEATURE_NAMES) {
      const feature = AI_FEATURES[name];
      const prompt = feature.system(inputs[name] as never, ctx);
      expect(prompt).toContain("ROLE:");
      expect(prompt).toContain("SECURITY:");
      expect(prompt.toLowerCase()).toContain("reasoning");
      expect(typeof feature.fallback).toBe("function");
    }
  });
});

describe("grounding guards against bad model output", () => {
  it("review drops moves that reference unknown or adopted measures", () => {
    const context = buildPlanContext(makePlan(), TODAY);
    const open = context.measures.find((m) => m.status !== "done")!;
    const grounded = AI_FEATURES.review.ground!(
      {
        advice: [{ title: "t", detail: "d" }],
        moves: [
          { measureId: open.id, why: "real" },
          { measureId: "ghost", why: "fake" },
        ],
        reasoning: "r",
      },
      { context } as never,
      ctx,
    );
    expect(grounded.moves.map((m) => m.measureId)).toEqual([open.id]);
  });

  it("chat keeps add proposals but validates adoptMeasure ids", () => {
    const context = buildPlanContext(makePlan(), TODAY);
    const open = context.measures.find((m) => m.status !== "done")!;
    const grounded = AI_FEATURES.chat.ground!(
      {
        reply: "ok",
        reasoning: "r",
        proposals: [
          { type: "addMeasure", label: "x", category: null, why: "w" },
          { type: "adoptMeasure", measureId: open.id, why: "w" },
          { type: "adoptMeasure", measureId: "ghost", why: "w" },
        ],
      },
      { context } as never,
      ctx,
    );
    expect(grounded.proposals).toHaveLength(2);
  });

  it("swaps throws when every suggestion was excluded, so failover kicks in", () => {
    expect(() =>
      AI_FEATURES.swaps.ground!(
        {
          swaps: [
            {
              title: "Metro",
              description: "d",
              category: "c",
              co2eKgPerWeek: 1,
              exposureReductionPerDay: 1,
              why: "w",
            },
          ],
          reasoning: "r",
        },
        { exclude: ["metro"] } as never,
        ctx,
      ),
    ).toThrow();
  });

  it("daysheet sorts items and interpret drops blank members", () => {
    const sheet = AI_FEATURES.daysheet.ground!(
      {
        items: [
          { time: "09:00", title: "b", note: "" },
          { time: "07:00", title: "a", note: "" },
        ],
        reasoning: "r",
      },
      { profile: makeProfile(), air: buildAirContext(makePlan().air), wakeTime: "07:00" },
      ctx,
    );
    expect(sheet.items.map((i) => i.time)).toEqual(["07:00", "09:00"]);

    const interpreted = AI_FEATURES.interpret.ground!(
      {
        profile: {
          members: [
            { label: "", group: "healthy" },
            { label: "Dad", group: "heart" },
          ],
        },
        assumptions: [],
        questions: [],
        reasoning: "r",
      },
      {} as never,
      ctx,
    );
    expect(interpreted.profile.members).toHaveLength(1);
  });
});

describe("the model cannot contradict the air the code measured", () => {
  it("recognises advice to open up the home, and not advice to keep it shut", () => {
    expect(suggestsOpeningUp("Ventilate home")).toBe(true);
    expect(suggestsOpeningUp("Open the windows at 13:00")).toBe(true);
    expect(suggestsOpeningUp("Air out the bedroom")).toBe(true);
    expect(suggestsOpeningUp("Keep windows shut today")).toBe(false);
    expect(suggestsOpeningUp("Avoid opening windows before noon")).toBe(false);
    expect(suggestsOpeningUp("Run the extractor fan while cooking")).toBe(false);
  });

  const profile = makeProfile();
  const dirtyAir = buildAirContext(makePlan().air); // Delhi: no clean window
  const output = {
    summary: "s",
    reasoning: "r",
    measures: [
      { label: "Another mask", category: "masks" as const, why: "w" },
      { label: "Walk the back lanes", category: null, why: "w" },
    ],
    routine: [
      { time: "13:00", title: "Ventilate home", why: "w", category: "ventilation" as const },
      {
        time: "18:00",
        title: "Close windows before dusk",
        why: "w",
        category: "ventilation" as const,
      },
    ],
  };

  it("personalize drops repeats of seeded measures and window-opening on a smoggy day", () => {
    expect(dirtyAir.safeToVentilate).toBe(false);
    const grounded = AI_FEATURES.personalize.ground!(output, { profile, air: dirtyAir }, ctx);
    expect(grounded.measures.map((m) => m.label)).toEqual(["Walk the back lanes"]);
    expect(grounded.routine.map((i) => i.title)).toEqual(["Close windows before dusk"]);
  });

  it("keeps window-opening advice when there is a genuinely clean window", () => {
    const cleanAir = { ...dirtyAir, safeToVentilate: true };
    const grounded = AI_FEATURES.personalize.ground!(output, { profile, air: cleanAir }, ctx);
    expect(grounded.routine).toHaveLength(2);
  });

  it("daysheet fails over rather than return a sheet that grounding emptied", () => {
    expect(() =>
      AI_FEATURES.daysheet.ground!(
        { items: [{ time: "13:00", title: "Open the windows", note: "" }], reasoning: "r" },
        { profile, air: dirtyAir, wakeTime: "07:00" },
        ctx,
      ),
    ).toThrow();
  });

  it("chat drops a routine proposal to open up on a smoggy day", () => {
    const context = buildPlanContext(makePlan(), TODAY);
    const grounded = AI_FEATURES.chat.ground!(
      {
        reply: "ok",
        reasoning: "r",
        proposals: [
          {
            type: "addRoutineItem",
            time: "13:00",
            title: "Air out the home",
            why: "w",
            category: "ventilation",
          },
          {
            type: "addRoutineItem",
            time: "21:00",
            title: "Run the purifier",
            why: "w",
            category: "purifier",
          },
        ],
      },
      { context, history: [], message: "x" },
      ctx,
    );
    expect(grounded.proposals).toHaveLength(1);
  });
});
