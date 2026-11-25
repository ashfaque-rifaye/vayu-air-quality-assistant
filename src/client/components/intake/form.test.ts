import { describe, expect, it } from "vitest";
import { tabIndexForKey } from "../PlanWorkspace";
import { applyDraft, emptyForm, validateForm, withCommuteDefault, type FormState } from "./form";

function filled(overrides: Partial<FormState> = {}): FormState {
  return { ...emptyForm(), household: "The Khan family", city: "Lahore", ...overrides };
}

describe("validateForm", () => {
  it("turns a complete form into a profile, with number inputs converted", () => {
    const form = filled({ home: { ...emptyForm().home, roomSqm: "18", purifierCadr: "" } });
    const { profile } = validateForm(form);
    expect(profile?.home.roomSqm).toBe(18);
    expect(profile?.home.purifierCadr).toBeNull();
    expect(profile?.commuteMinutes).toBe(0);
  });

  it("names each missing field the person can fix", () => {
    const { errors } = validateForm(emptyForm());
    expect(Object.keys(errors ?? {})).toEqual(expect.arrayContaining(["household", "city"]));
  });

  it("falls back to a general message when no fixable field is to blame", () => {
    const { errors } = validateForm(filled({ commuteTime: "not a time" }));
    expect(errors).toEqual({ household: "Please check the details above." });
  });
});

describe("withCommuteDefault", () => {
  it("gives a chosen commute a typical duration, and leaves a given one alone", () => {
    expect(withCommuteDefault(filled({ commuteMode: "bus" })).commuteMinutes).toBe("30");
    expect(
      withCommuteDefault(filled({ commuteMode: "bus", commuteMinutes: "45" })).commuteMinutes,
    ).toBe("45");
    expect(withCommuteDefault(filled()).commuteMinutes).toBe("0");
  });
});

describe("applyDraft", () => {
  it("fills only what the AI read and keeps everything else", () => {
    const form = filled({ notes: "keep me" });
    const next = applyDraft(form, {
      city: "Delhi",
      household: "",
      home: { nearRoad: true, hasPurifier: false },
      commuteMode: "metro",
      concerns: ["children", "elderly", "sleep", "budget"],
    });
    expect(next.city).toBe("Delhi");
    expect(next.household).toBe("The Khan family");
    expect(next.notes).toBe("keep me");
    expect(next.home).toMatchObject({ nearRoad: true, hasPurifier: false, cookingFuel: "lpg" });
    expect(next.commuteMinutes).toBe("30");
    expect(next.concerns).toHaveLength(3);
  });

  it("replaces the people only when the AI found some", () => {
    const form = filled();
    expect(applyDraft(form, { members: [] }).members).toBe(form.members);
    const people = applyDraft(form, { members: [{ label: "Dadi", group: "senior" }] }).members;
    expect(people.map((m) => [m.label, m.group])).toEqual([["Dadi", "senior"]]);
  });
});

describe("tabIndexForKey (ARIA tabs keyboard pattern)", () => {
  it.each([
    ["ArrowRight", 0, 1],
    ["ArrowRight", 5, 0],
    ["ArrowLeft", 0, 5],
    ["ArrowLeft", 3, 2],
    ["Home", 4, 0],
    ["End", 1, 5],
    ["Enter", 2, -1],
  ])("%s from tab %i goes to %i of six", (key, from, to) => {
    expect(tabIndexForKey(key, from, 6)).toBe(to);
  });
});
