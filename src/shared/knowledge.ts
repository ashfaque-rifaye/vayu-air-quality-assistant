/**
 * Air-quality knowledge: the deterministic skeleton the AI layer personalises.
 *
 * The measure catalogue and the swap bank are curated, honest defaults, so a
 * household always has a complete, sensible plan even with no model available.
 */
import type { MeasureCategory, Measure, Profile } from "./schemas.js";

export interface MeasureTemplate {
  category: MeasureCategory;
  label: string;
  blurb: string;
  /** Typical one-off cost in INR, or null for free or behavioural measures. */
  typicalCost: number | null;
  effortDays: number;
  checklist: readonly string[];
}

export const MEASURE_TEMPLATES: Record<MeasureCategory, MeasureTemplate> = {
  purifier: {
    category: "purifier",
    label: "Air purifier for the bedroom",
    blurb:
      "A HEPA purifier is the single biggest indoor win: it removes the fine particles that seep in.",
    typicalCost: 12000,
    effortDays: 3,
    checklist: [
      "Measure the main room and note its area in square metres",
      "Pick a true-HEPA purifier with a CADR of at least 5x the room area",
      "Run it in the bedroom overnight and during the evening peak",
      "Replace the filter on schedule and keep a spare",
    ],
  },
  masks: {
    category: "masks",
    label: "Fitted N95 or FFP2 masks for everyone",
    blurb:
      "A sealed respirator removes most PM2.5 you breathe outdoors. Cloth and surgical masks do not.",
    typicalCost: 1500,
    effortDays: 1,
    checklist: [
      "Buy certified N95 or FFP2, not cloth or surgical masks",
      "Fit-check each person: no air leaking around the edges",
      "Keep one by the door for every family member",
      "Replace when it is damp or hard to breathe through",
    ],
  },
  sealing: {
    category: "sealing",
    label: "Seal draughts around doors and windows",
    blurb:
      "Sealing the gaps keeps outdoor smog out and lets a purifier actually get ahead of the room.",
    typicalCost: 1200,
    effortDays: 2,
    checklist: [
      "Find draughts around doors, windows and wall vents",
      "Add weather-strip or draught tape to the gaps",
      "Start with the bedroom and the purifier's room",
      "Keep one vent you can open when outdoor air is clean",
    ],
  },
  ventilation: {
    category: "ventilation",
    label: "Ventilate only in the cleanest window",
    blurb:
      "Timing matters: airing the home in the day's cleanest hour refreshes it without letting the peak in.",
    typicalCost: null,
    effortDays: 0,
    checklist: [
      "Check the forecast for the day's cleanest hours",
      "Open windows only in that window",
      "Close up before the evening peak",
      "Never ventilate during a peak, even if it feels stuffy",
    ],
  },
  cooking: {
    category: "cooking",
    label: "Clean cooking and strong extraction",
    blurb:
      "A wood or kerosene stove adds more PM2.5 indoors than the smog outside. Clean fuel and extraction fix that.",
    typicalCost: 6000,
    effortDays: 7,
    checklist: [
      "Prefer induction or LPG over wood or kerosene",
      "Use the extractor or open a window to the outside while cooking",
      "Keep the kitchen door shut to the rest of the home",
      "Never burn wood or waste indoors for heat",
    ],
  },
  commute: {
    category: "commute",
    label: "A cleaner, enclosed commute",
    blurb:
      "An enclosed, filtered trip out of the peak hour cuts the dose from the most polluted part of many days.",
    typicalCost: null,
    effortDays: 1,
    checklist: [
      "Prefer an enclosed, filtered vehicle (metro, or a car on recirculate)",
      "Shift the trip out of the morning and evening peaks where you can",
      "Mask up for any open-air leg of the journey",
      "Keep car vents on recirculate in slow traffic",
    ],
  },
  exercise: {
    category: "exercise",
    label: "Move hard exercise indoors on smoggy days",
    blurb:
      "Breathing hard outdoors can multiply your dose fivefold. Save intense sessions for clean air or indoors.",
    typicalCost: null,
    effortDays: 0,
    checklist: [
      "Check the AQI before any outdoor workout",
      "Move hard sessions indoors when PM2.5 is over 55",
      "Keep easy sessions for the day's cleanest window",
      "Watch children and older adults for any symptoms",
    ],
  },
  monitoring: {
    category: "monitoring",
    label: "Track your local AQI every day",
    blurb:
      "You cannot act on what you cannot see. A daily check turns the plan into the right decision each morning.",
    typicalCost: null,
    effortDays: 0,
    checklist: [
      "Save a trusted AQI source for your area",
      "Check it each morning and evening",
      "Act on the peaks: shut windows, run the purifier, mask up",
      "Share the plan so the whole household follows it",
    ],
  },
  heating: {
    category: "heating",
    label: "Heat without burning indoors",
    blurb:
      "Wood and kerosene heaters are a major indoor PM2.5 source. Electric or sealed-flue heat avoids it.",
    typicalCost: null,
    effortDays: 1,
    checklist: [
      "Avoid wood and kerosene heaters indoors",
      "Prefer electric or a sealed-flue appliance",
      "If you must burn, vent it fully to the outside",
      "Layer clothing and seal draughts to need less heat",
    ],
  },
  plants: {
    category: "plants",
    label: "A few indoor plants (a small help)",
    blurb:
      "Plants do a little for PM2.5 and lift a room, but they are no substitute for filtering and sealing.",
    typicalCost: 800,
    effortDays: 1,
    checklist: [
      "Treat plants as a small help, not a replacement for a purifier",
      "Choose hardy indoor species and keep them healthy",
      "Do not let the soil go mouldy, which worsens the air",
      "Rely on filtering and sealing for the real gains",
    ],
  },
};

function checksFor(category: MeasureCategory): Measure["checks"] {
  return MEASURE_TEMPLATES[category].checklist.map((label, index) => ({
    id: `check-${index + 1}`,
    label,
    done: false,
  }));
}

/** The starting set of measures, tailored to the household's own situation. */
export function seedMeasures(profile: Profile): Measure[] {
  const categories: MeasureCategory[] = [
    "purifier",
    "masks",
    "sealing",
    "ventilation",
    "monitoring",
  ];
  if (profile.commuteMode !== "none") categories.push("commute");
  if (profile.outdoorActivity !== "none") categories.push("exercise");
  if (["wood", "kerosene", "gas"].includes(profile.home.cookingFuel)) categories.push("cooking");
  if (["wood", "kerosene"].includes(profile.home.heating)) categories.push("heating");

  return categories.map((category, index): Measure => {
    const template = MEASURE_TEMPLATES[category];
    const alreadyDone = category === "purifier" && profile.home.hasPurifier;
    return {
      id: `measure-${index + 1}`,
      category,
      label: template.label,
      status: alreadyDone ? "done" : "suggested",
      cost: template.typicalCost,
      effortDays: template.effortDays,
      notes: "",
      source: "template",
      checks: checksFor(category),
    };
  });
}

export function measureChecklist(category: MeasureCategory): string[] {
  return [...MEASURE_TEMPLATES[category].checklist];
}

/** Keyword rules, most specific first, for labelling free text by category. */
const CATEGORY_KEYWORDS: readonly [RegExp, MeasureCategory][] = [
  [/\b(n95|ffp2|kn95|respirator|masks?)\b/i, "masks"],
  [/\b(purifiers?|hepa|cadr|filter(s|ing|ed)?)\b/i, "purifier"],
  [/\b(cook\w*|stoves?|kitchen|chimney|extractor|exhaust fan|chulha)\b/i, "cooking"],
  [/\b(heat\w*|fireplace|angithi)\b/i, "heating"],
  [/\b(seal\w*|draughts?|drafts?|gaps?|weather-?strip\w*)\b/i, "sealing"],
  [/\b(windows?|ventilat\w*|air(ing)? out|balcony)\b/i, "ventilation"],
  [/\b(commut\w*|cycl\w*|driv\w*|metro|bus|school run|traffic|car|scooter)\b/i, "commute"],
  [/\b(exercis\w*|workout|run|jog\w*|yoga|gym|sport|play\w*)\b/i, "exercise"],
  [/\b(plants?)\b/i, "plants"],
];

/**
 * The category a piece of free text is about, or "monitoring" when nothing fits.
 * Used to label AI suggestions that arrive without a usable category.
 */
export function inferCategory(text: string): MeasureCategory {
  return CATEGORY_KEYWORDS.find(([pattern]) => pattern.test(text))?.[1] ?? "monitoring";
}

/** Short one-word labels for category chips in the UI. */
export const MEASURE_SHORT_LABELS: Record<MeasureCategory, string> = {
  purifier: "Purifier",
  masks: "Mask",
  sealing: "Sealing",
  ventilation: "Ventilation",
  cooking: "Cooking",
  commute: "Commute",
  exercise: "Exercise",
  monitoring: "Check",
  plants: "Plants",
  heating: "Heating",
};

export interface SwapTemplate {
  title: string;
  description: string;
  category: string;
  /** The modelled measure this swap maps to, for a real exposure estimate. */
  measure: MeasureCategory | null;
  co2eKgPerWeek: number;
  /** Used only when `measure` is null: a flat exposure estimate. */
  exposureReductionPerDay: number;
  why: string;
}

/** Curated sustainable alternatives, each with its direct impact spelled out. */
export const SWAP_BANK: readonly SwapTemplate[] = [
  {
    title: "Take the metro or carpool on smog days",
    description:
      "Swap a solo drive or motorbike ride for an enclosed, shared trip during high-AQI mornings.",
    category: "Commute",
    measure: "commute",
    co2eKgPerWeek: 14,
    exposureReductionPerDay: 350,
    why: "Cuts roadside particles you breathe and the tailpipe emissions you add.",
  },
  {
    title: "Cook on induction or LPG, not wood or kerosene",
    description: "Move the dirtiest cooking to a clean fuel and run the extractor every time.",
    category: "Cooking",
    measure: "cooking",
    co2eKgPerWeek: 9,
    exposureReductionPerDay: 600,
    why: "Removes a PM2.5 source that is often worse indoors than the smog outside.",
  },
  {
    title: "Heat without burning indoors",
    description:
      "Replace a wood or kerosene heater with electric or sealed-flue warmth, and seal draughts.",
    category: "Heating",
    measure: "heating",
    co2eKgPerWeek: 22,
    exposureReductionPerDay: 700,
    why: "Stops a heavy indoor particle source and lowers your winter fuel emissions.",
  },
  {
    title: "Batch errands into the clean-air window",
    description: "Group trips and walk or cycle only when the forecast is at its cleanest.",
    category: "Commute",
    measure: null,
    co2eKgPerWeek: 6,
    exposureReductionPerDay: 180,
    why: "Fewer, better-timed trips cut both your exposure and your emissions.",
  },
  {
    title: "Dry and warm the smart way",
    description:
      "Dry laundry and take the chill off rooms without a stove or heater running for hours.",
    category: "Energy",
    measure: null,
    co2eKgPerWeek: 8,
    exposureReductionPerDay: 90,
    why: "Less indoor burning means cleaner air and lower energy use.",
  },
  {
    title: "Seal and filter instead of running the AC fresh-air intake",
    description:
      "Keep conditioned air recirculating through a filter rather than pulling in outdoor smog.",
    category: "Home",
    measure: null,
    co2eKgPerWeek: 4,
    exposureReductionPerDay: 140,
    why: "Protects indoor air and avoids heating or cooling air you keep replacing.",
  },
];
