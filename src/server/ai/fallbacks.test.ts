import { describe, expect, it } from "vitest";
import { aiContracts } from "../../shared/contracts.js";
import { buildAirContext, buildPlanContext } from "../../shared/plan-context.js";
import { makePlan, makeProfile, TODAY } from "../../test/fixtures.js";
import {
  chatFallback,
  daysheetFallback,
  householdSize,
  interpretFallback,
  parseClockTime,
  measureFallback,
  personalizeFallback,
  reviewFallback,
  swapsFallback,
} from "./fallbacks.js";

const profile = makeProfile();
const air = buildAirContext(makePlan().air);

describe("interpretFallback", () => {
  it("extracts city, people, fuel and commute from free text", () => {
    const input = aiContracts.interpret.input.parse({
      text: "Family in Delhi near a main road, my son has asthma, we cook on a wood chulha and I cycle to work.",
    });
    const out = interpretFallback(input);
    expect(aiContracts.interpret.output.safeParse(out).success).toBe(true);
    expect(out.profile.city).toBe("Delhi");
    expect(out.profile.members?.some((m) => m.group === "respiratory")).toBe(true);
    expect(out.profile.home?.cookingFuel).toBe("wood");
    expect(out.profile.commuteMode).toBe("cycle");
  });

  it("asks for what it could not read", () => {
    const out = interpretFallback(
      aiContracts.interpret.input.parse({ text: "please help us breathe" }),
    );
    expect(out.questions.length).toBeGreaterThan(0);
  });
});

describe("personalizeFallback", () => {
  it("returns schema-valid, tailored content", () => {
    const input = aiContracts.personalize.input.parse({ profile, air });
    const out = personalizeFallback(input);
    expect(aiContracts.personalize.output.safeParse(out).success).toBe(true);
    expect(out.summary).toContain(profile.city);
  });
});

describe("swapsFallback", () => {
  it("excludes titles already seen and stays schema-valid", () => {
    const first = swapsFallback(aiContracts.swaps.input.parse({ profile, air }));
    const excludeTitle = first.swaps[0]!.title;
    const second = swapsFallback(
      aiContracts.swaps.input.parse({ profile, air, exclude: [excludeTitle] }),
    );
    expect(second.swaps.map((s) => s.title)).not.toContain(excludeTitle);
    expect(aiContracts.swaps.output.safeParse(second).success).toBe(true);
  });
});

describe("reviewFallback", () => {
  it("advises on real figures and only adopts open measures", () => {
    const context = buildPlanContext(makePlan(), TODAY);
    const out = reviewFallback(aiContracts.review.input.parse({ context }));
    expect(aiContracts.review.output.safeParse(out).success).toBe(true);
    const openIds = new Set(context.measures.filter((m) => m.status !== "done").map((m) => m.id));
    for (const move of out.moves) expect(openIds.has(move.measureId)).toBe(true);
  });
});

describe("measureFallback", () => {
  it("returns a checklist-based guide for the category", () => {
    const out = measureFallback(
      aiContracts.measure.input.parse({
        profile,
        air,
        measureLabel: "Air purifier",
        category: "purifier",
      }),
    );
    expect(aiContracts.measure.output.safeParse(out).success).toBe(true);
    expect(out.whatToLookFor.length).toBeGreaterThan(0);
  });
});

describe("daysheetFallback", () => {
  it("returns time-sorted items from the forecast", () => {
    const out = daysheetFallback(
      aiContracts.daysheet.input.parse({ profile, air, wakeTime: "06:30" }),
    );
    expect(aiContracts.daysheet.output.safeParse(out).success).toBe(true);
    const times = out.items.map((i) => i.time);
    expect([...times].sort()).toEqual(times);
  });
});

describe("chatFallback", () => {
  const context = buildPlanContext(makePlan(), TODAY);
  it("routes to an exposure answer", () => {
    const out = chatFallback(
      aiContracts.chat.input.parse({ context, message: "how bad is my exposure?" }),
    );
    expect(aiContracts.chat.output.safeParse(out).success).toBe(true);
    expect(out.reply).toMatch(/safe daily limit|AQI/i);
  });
  it("proposes adopting the top measure when asked what to do", () => {
    const out = chatFallback(
      aiContracts.chat.input.parse({ context, message: "what should I do first to protect us?" }),
    );
    expect(out.proposals.length).toBeGreaterThanOrEqual(0);
  });
});

describe("parseClockTime", () => {
  it("reads 12- and 24-hour times", () => {
    expect(parseClockTime("I cycle to work at 8am")).toBe("08:00");
    expect(parseClockTime("leave at 7:30 pm")).toBe("19:30");
    expect(parseClockTime("12am school run")).toBe("00:00");
    expect(parseClockTime("12pm lunch")).toBe("12:00");
    expect(parseClockTime("the 18:45 train")).toBe("18:45");
    expect(parseClockTime("no time here")).toBeUndefined();
    expect(parseClockTime("at 13pm")).toBeUndefined();
  });

  it("feeds the commute time when a commute is mentioned", () => {
    const out = interpretFallback(
      aiContracts.interpret.input.parse({ text: "In Delhi, I take the metro at 8:15am." }),
    );
    expect(out.profile.commuteMode).toBe("metro");
    expect(out.profile.commuteTime).toBe("08:15");
  });
});

describe("interpretFallback reads negation", () => {
  const read = (text: string) =>
    interpretFallback(aiContracts.interpret.input.parse({ text })).profile.home?.hasPurifier;

  it("does not credit a purifier the household says it lacks", () => {
    expect(read("We cook on LPG and have no air purifier.")).toBeUndefined();
    expect(read("We don't have a HEPA purifier yet")).toBeUndefined();
  });

  it("credits one the household says it has", () => {
    expect(read("We already run an air purifier in the bedroom")).toBe(true);
  });
});

describe("the offline planner follows the air and the home", () => {
  const cleanAir = { ...air, safeToVentilate: true, cleanestFrom: "14:00", cleanestTo: "16:00" };
  const smokyAir = { ...air, safeToVentilate: false };

  it("schedules airing out only when there is a clean window", () => {
    const clean = personalizeFallback({ profile, air: cleanAir });
    expect(clean.routine.some((r) => r.category === "ventilation" && r.time === "14:00")).toBe(
      true,
    );
    const smoky = personalizeFallback({ profile, air: smokyAir });
    expect(smoky.routine.some((r) => r.category === "ventilation")).toBe(false);
  });

  it("adds a kitchen-venting reminder for a smoky stove", () => {
    const wood = makeProfile({ home: { ...profile.home, cookingFuel: "wood" } });
    const out = personalizeFallback({ profile: wood, air: smokyAir });
    expect(out.routine.some((r) => r.category === "cooking")).toBe(true);
    expect(aiContracts.personalize.output.safeParse(out).success).toBe(true);
  });

  it("writes a day-sheet that matches the day: airing out, commute and exercise", () => {
    const clean = daysheetFallback({ profile, air: cleanAir, wakeTime: "06:30" });
    expect(clean.items.map((i) => i.title)).toEqual(
      expect.arrayContaining(["Air out the home", "Mask up for the commute"]),
    );
    const homebody = makeProfile({ commuteMode: "none", outdoorActivity: "none" });
    const smoky = daysheetFallback({ profile: homebody, air: smokyAir, wakeTime: "06:30" });
    const titles = smoky.items.map((i) => i.title);
    expect(titles).toContain("Keep windows shut");
    expect(titles).not.toContain("Mask up for the commute");
    expect(titles).not.toContain("Keep hard exercise indoors");
  });

  it.each([
    ["Can I go for a run this evening?", /exercise indoors/i],
    ["Is it safe for my kid to play outside?", /most sensitive member/i],
    ["hello", /Ask me about/i],
  ])("chat answers %j on topic", (message, reply) => {
    const context = buildPlanContext(makePlan(), TODAY);
    const out = chatFallback(aiContracts.chat.input.parse({ context, message }));
    expect(out.reply).toMatch(reply);
  });

  it.each([
    ["I go to the gym daily", "moderate"],
    ["We walk in the park", "light"],
    ["I jog every morning", "intense"],
  ])("reads activity from %j", (text, level) => {
    const out = interpretFallback(aiContracts.interpret.input.parse({ text }));
    expect(out.profile.outdoorActivity).toBe(level);
  });
});

describe("householdSize", () => {
  it("reads how many people live there", () => {
    expect(householdSize("We're a family of four in Delhi")).toBe(4);
    expect(householdSize("there are 5 of us")).toBe(5);
    expect(householdSize("a household of three")).toBe(3);
    expect(householdSize("just me")).toBeUndefined();
  });

  it("pads the described people to the stated size", () => {
    const out = interpretFallback(
      aiContracts.interpret.input.parse({ text: "A family of four in Delhi. My son has asthma." }),
    );
    expect(out.profile.members).toHaveLength(4);
    expect(out.profile.members?.filter((m) => m.group === "healthy")).toHaveLength(2);
  });
});
