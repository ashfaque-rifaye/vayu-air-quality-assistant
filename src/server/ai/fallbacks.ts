/**
 * The deterministic planner: what answers when no model can.
 *
 * Every AI feature has a fallback here, so a missing key, an exhausted free tier
 * or a provider outage degrades the app instead of breaking it. The UI badge says
 * plainly when this is what answered. These are honest rules and curated content,
 * and they do not pretend to be as adaptive as the model.
 */
import { TARGET_DOSE, formatDose } from "../../shared/exposure.js";
import { MEASURE_TEMPLATES, SWAP_BANK } from "../../shared/knowledge.js";
import type { AiOutput, AiParsedInput } from "../../shared/contracts.js";
import type { CommuteMode, PlanProposal, SensitivityGroup } from "../../shared/schemas.js";

// --- Interpret a free-text description -------------------------------------

const CITY = /\b(?:in|at|from|near)\s+([A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]{2,})?)/;

const MEMBER_RULES: readonly [RegExp, SensitivityGroup, string][] = [
  [
    /\b(asthma|asthmatic|copd|respiratory|wheez|allerg|bronchit)\w*/i,
    "respiratory",
    "Someone with a breathing condition",
  ],
  [/\b(pregnant|pregnancy|expecting)\b/i, "pregnant", "Expectant mother"],
  [/\b(heart|cardiac|cardiovascular|blood pressure)\b/i, "heart", "Someone with a heart condition"],
  [
    /\b(grandmother|grandfather|grandparent|elderly|senior|old(?:er)? (?:parent|mother|father))\b/i,
    "senior",
    "Older adult",
  ],
  [
    /\b(kid|kids|child|children|son|daughter|baby|babies|toddler|infant|school)\w*/i,
    "child",
    "Child",
  ],
];

const FUEL_RULES: readonly [RegExp, "induction" | "lpg" | "gas" | "wood" | "kerosene"][] = [
  [/\b(wood|chulha|biomass|dung|coal|firewood)\b/i, "wood"],
  [/\bkerosene\b/i, "kerosene"],
  [/\b(induction|electric (?:stove|hob))\b/i, "induction"],
  [/\b(lpg|cylinder|gas stove|piped gas)\b/i, "lpg"],
];

const COMMUTE_RULES: readonly [RegExp, CommuteMode][] = [
  [/\b(metro|subway|underground)\b/i, "metro"],
  [/\bbus\b/i, "bus"],
  [/\b(scooter|motorbike|motorcycle|two-wheeler|bike)\b/i, "motorbike"],
  [/\b(cycle|bicycle|cycling)\b/i, "cycle"],
  [/\b(drive|driving|car|cab|taxi|auto)\b/i, "car"],
  [/\bwalk\w*\b/i, "walk"],
];

/** The first clock time in the text ("8am", "7:30 pm", "18:00") as 24-hour HH:MM. */
export function parseClockTime(text: string): string | undefined {
  const match = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text);
  if (!match) return undefined;
  let hours = Number(match[1] ?? match[4]);
  const minutes = Number(match[2] ?? match[5] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12 || minutes > 59) return undefined;
    hours = (hours % 12) + (meridiem === "pm" ? 12 : 0);
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function interpretFallback(input: AiParsedInput<"interpret">): AiOutput<"interpret"> {
  const { text } = input;
  const profile: AiOutput<"interpret">["profile"] = { notes: text.slice(0, 600) };

  const city = CITY.exec(text)?.[1];
  if (city) profile.city = city;

  const members = MEMBER_RULES.filter(([pattern]) => pattern.test(text)).map(
    ([, group, label]) => ({ label, group }),
  );
  if (members.length > 0) profile.members = members.slice(0, 12);

  const fuel = FUEL_RULES.find(([pattern]) => pattern.test(text))?.[1];
  const mentionsPurifier = /\b(purifier|hepa)\b/i.test(text);
  const deniesPurifier =
    /\b(no|without|not|don't|do not|never)\b[^.]{0,25}\b(purifier|hepa)\b/i.test(text);
  const purifier = mentionsPurifier && !deniesPurifier;
  const nearRoad = /\b(main road|highway|busy road|roadside|heavy traffic|near the road)\b/i.test(
    text,
  );
  if (fuel || purifier || nearRoad) {
    profile.home = {
      ...(fuel ? { cookingFuel: fuel } : {}),
      ...(purifier ? { hasPurifier: true } : {}),
      ...(nearRoad ? { nearRoad: true } : {}),
    };
  }

  const commute = COMMUTE_RULES.find(([pattern]) => pattern.test(text))?.[1];
  if (commute) profile.commuteMode = commute;
  const leaves = commute ? parseClockTime(text) : undefined;
  if (leaves) profile.commuteTime = leaves;

  if (/\b(run|running|jog|jogging|marathon|sprint)\w*/i.test(text))
    profile.outdoorActivity = "intense";
  else if (/\b(gym|workout|sport|football|cricket|cycling)\w*/i.test(text))
    profile.outdoorActivity = "moderate";
  else if (/\b(walk|stroll|yoga outside)\w*/i.test(text)) profile.outdoorActivity = "light";

  const questions: string[] = [];
  if (!city) questions.push("Which city are you in? Winter smog varies a lot by place.");
  if (members.length === 0)
    questions.push(
      "Who lives with you, and is anyone a child, older, pregnant or living with a lung or heart condition?",
    );
  if (!fuel) questions.push("How do you cook and heat your home?");

  return {
    profile,
    assumptions: [],
    questions: questions.slice(0, 3),
    reasoning: "Read with simple pattern matching because the AI model was unavailable.",
  };
}

// --- Personalise the plan --------------------------------------------------

/** Most to least at risk, so the fallback speaks to whoever needs it most. */
const VULNERABLE_ORDER: readonly SensitivityGroup[] = [
  "child",
  "respiratory",
  "heart",
  "pregnant",
  "senior",
];

const GROUP_NOUN: Record<SensitivityGroup, string> = {
  healthy: "family",
  child: "child",
  respiratory: "family member with a breathing condition",
  heart: "family member with a heart condition",
  pregnant: "expectant mother",
  senior: "older family member",
};

export function personalizeFallback(input: AiParsedInput<"personalize">): AiOutput<"personalize"> {
  const { profile, air } = input;
  const measures: AiOutput<"personalize">["measures"] = [];
  const routine: AiOutput<"personalize">["routine"] = [];
  const vulnerable = VULNERABLE_ORDER.map((group) =>
    profile.members.find((m) => m.group === group),
  ).find(Boolean);

  // Measures here are local, behavioural additions (category null), so they never
  // duplicate the standard measures the plan already starts with.
  if (profile.home.nearRoad) {
    measures.push({
      label: "Walk the back lanes, not the main road",
      category: null,
      why: "You live by a busy road, where particles run far higher than the city average; a street or two away is measurably cleaner.",
    });
  }
  if (vulnerable) {
    const who = GROUP_NOUN[vulnerable.group];
    measures.push({
      label: `Keep a symptom plan and a clinician's number for the ${who}`,
      category: null,
      why: `The ${who} is most at risk on smog days, so knowing what to watch for and who to call matters most.`,
    });
    routine.push({
      time: "08:00",
      title: `Morning symptom check for the ${who}`,
      why: "Catching a cough or tight chest early lets you act before the evening peak.",
      category: "monitoring",
    });
  }
  if (air.safeToVentilate) {
    routine.push({
      time: air.cleanestFrom,
      title: `Air out the home ${air.cleanestFrom}-${air.cleanestTo}`,
      why: "This is the cleanest stretch today; ventilate then, and keep windows shut the rest of the day.",
      category: "ventilation",
    });
  }
  if (["wood", "kerosene"].includes(profile.home.cookingFuel)) {
    routine.push({
      time: "19:00",
      title: "Vent the kitchen hard while cooking",
      why: "Your stove adds more particles indoors than the smog outside, so extract them every time.",
      category: "cooking",
    });
  }

  return {
    summary: `A plan for ${profile.city} at ${air.level.toLowerCase()} air (AQI ${air.aqi}), built from Vayu's standard playbook.`,
    measures: measures.slice(0, 6),
    routine: routine.slice(0, 6),
    reasoning:
      "Matched your situation against clean-air rules because the AI model was unavailable.",
  };
}

// --- Sustainable swaps -----------------------------------------------------

function swapApplies(
  measure: (typeof SWAP_BANK)[number]["measure"],
  profile: AiParsedInput<"swaps">["profile"],
): boolean {
  if (measure === "commute") return profile.commuteMode !== "none";
  if (measure === "cooking") return ["wood", "kerosene", "gas"].includes(profile.home.cookingFuel);
  if (measure === "heating") return ["wood", "kerosene"].includes(profile.home.heating);
  return true;
}

export function swapsFallback(input: AiParsedInput<"swaps">): AiOutput<"swaps"> {
  const { profile, exclude } = input;
  const excluded = new Set(exclude.map((title) => title.toLowerCase()));
  const relevant = SWAP_BANK.filter(
    (swap) => swapApplies(swap.measure, profile) && !excluded.has(swap.title.toLowerCase()),
  );
  const chosen = (
    relevant.length >= 4 ? relevant : SWAP_BANK.filter((s) => !excluded.has(s.title.toLowerCase()))
  ).slice(0, 4);
  const swaps = chosen.map((swap) => ({
    title: swap.title,
    description: swap.description,
    category: swap.category,
    co2eKgPerWeek: swap.co2eKgPerWeek,
    exposureReductionPerDay: swap.exposureReductionPerDay,
    why: swap.why,
  }));
  return {
    swaps: swaps.length > 0 ? swaps : [defaultSwap()],
    reasoning:
      "Curated sustainable swaps for your situation, because the AI model was unavailable.",
  };
}

function defaultSwap(): AiOutput<"swaps">["swaps"][number] {
  const first = SWAP_BANK[0]!;
  return {
    title: first.title,
    description: first.description,
    category: first.category,
    co2eKgPerWeek: first.co2eKgPerWeek,
    exposureReductionPerDay: first.exposureReductionPerDay,
    why: first.why,
  };
}

// --- Exposure review -------------------------------------------------------

const MEASURE_PRIORITY: Record<string, number> = {
  purifier: 10,
  cooking: 9,
  heating: 8,
  masks: 7,
  sealing: 6,
  commute: 5,
  exercise: 4,
  ventilation: 3,
  monitoring: 2,
  plants: 1,
};

export function reviewFallback(input: AiParsedInput<"review">): AiOutput<"review"> {
  const { context } = input;
  const open = context.measures
    .filter((m) => m.status !== "done" && m.status !== "dismissed")
    .sort((a, b) => (MEASURE_PRIORITY[b.category] ?? 0) - (MEASURE_PRIORITY[a.category] ?? 0));

  const advice: AiOutput<"review">["advice"] = [
    {
      title: `You are breathing about ${context.timesTarget}x the safe daily limit`,
      detail: `Today's dose is about ${formatDose(context.exposureNow)} against a safe target of ${formatDose(TARGET_DOSE)}. The ${context.mostVulnerable} member is most affected.`,
    },
  ];
  const top = open[0];
  if (top) {
    advice.push({
      title: `Start with: ${top.label}`,
      detail:
        "This is the highest-impact measure you have not adopted yet. Marking it done moves your protection score the most.",
    });
  }
  advice.push({
    title: `Air is ${context.airLevel.toLowerCase()} today`,
    detail:
      "On days like this, the order that matters is: seal and filter the bedroom, avoid outdoor exertion, then mask any trips outside.",
  });

  const moves: AiOutput<"review">["moves"] = open.slice(0, 2).map((measure) => ({
    measureId: measure.id,
    why: `Adopting ${measure.label.toLowerCase()} is a strong next step for your household.`,
  }));

  return {
    advice: advice.slice(0, 4),
    moves,
    reasoning: "Ranked your own measures by impact, because the AI model was unavailable.",
  };
}

// --- Measure guidance ------------------------------------------------------

export function measureFallback(input: AiParsedInput<"measure">): AiOutput<"measure"> {
  const template = MEASURE_TEMPLATES[input.category];
  return {
    whatToLookFor: [...template.checklist],
    redFlags: [
      "Claims that sound too good, like removing all particles or needing no filter changes",
      "No clear specification you can check against your room or your needs",
    ],
    tip: `${template.blurb} Spend where the exposure is, not on extras.`,
    reasoning: "A standard setup checklist for this measure, because the AI model was unavailable.",
  };
}

// --- Day-sheet -------------------------------------------------------------

export function daysheetFallback(input: AiParsedInput<"daysheet">): AiOutput<"daysheet"> {
  const { profile, air, wakeTime } = input;
  const items: AiOutput<"daysheet">["items"] = [
    {
      time: wakeTime,
      title: "Check today's air",
      note: `AQI about ${air.aqi}, ${air.level.toLowerCase()}`,
    },
  ];

  if (air.safeToVentilate) {
    items.push({
      time: air.cleanestFrom,
      title: "Air out the home",
      note: `cleanest window, until ${air.cleanestTo}`,
    });
  } else {
    items.push({ time: "09:00", title: "Keep windows shut", note: "no clean window today" });
  }
  if (profile.commuteMode !== "none") {
    items.push({
      time: profile.commuteTime,
      title: "Mask up for the commute",
      note: "fitted N95, not cloth",
    });
  }
  if (profile.outdoorActivity !== "none") {
    items.push({
      time: profile.outdoorTime,
      title: "Keep hard exercise indoors",
      note: "hard breathing multiplies the dose",
    });
  }
  items.push({
    time: "18:00",
    title: "Close windows before the evening peak",
    note: "PM2.5 climbs as air cools",
  });
  items.push({
    time: "21:00",
    title: "Run the bedroom purifier overnight",
    note: "the longest high-exposure stretch",
  });

  return {
    items: items.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 12),
    reasoning: "A standard day-sheet from today's forecast, because the AI model was unavailable.",
  };
}

// --- Assistant -------------------------------------------------------------

export function chatFallback(input: AiParsedInput<"chat">): AiOutput<"chat"> {
  const { context, message } = input;
  const text = message.toLowerCase();
  const reasoning = "Answered from your plan data, because the AI model was unavailable.";
  const open = context.measures.filter((m) => m.status !== "done" && m.status !== "dismissed");

  if (/exposure|dose|breath|pm2|pollut|cigarette|how bad/.test(text)) {
    return {
      reply: `Today's air in ${context.city} is ${context.airLevel.toLowerCase()} (AQI ${context.aqi}). Your household is breathing about ${context.timesTarget}x the safe daily limit, and the ${context.mostVulnerable} member is most at risk. Adopting your top measures is the fastest way to cut that.`,
      reasoning,
      proposals: [],
    };
  }
  if (/measure|purifier|mask|seal|protect|buy|what should|do first/.test(text)) {
    const top = open[0];
    const proposals: PlanProposal[] = top
      ? [
          {
            type: "adoptMeasure",
            measureId: top.id,
            why: "Highest-impact measure not yet in place.",
          },
        ]
      : [];
    return {
      reply: open.length
        ? `${open.length} measures are not in place yet. The biggest next step is ${top?.label.toLowerCase()}. I can mark it done for you to track it.`
        : "Every measure in your plan is already adopted. Keep an eye on the daily forecast and your routine.",
      reasoning,
      proposals,
    };
  }
  if (/exercise|run|jog|gym|workout|walk|outdoor/.test(text)) {
    return {
      reply: `On ${context.airLevel.toLowerCase()} days, keep hard exercise indoors: breathing hard outdoors can multiply the dose several times over. Save easy outdoor time for the cleanest part of the day.`,
      reasoning,
      proposals: [],
    };
  }
  if (/child|kid|baby|asthma|elder|senior|pregnan|vulnerable|safe/.test(text)) {
    return {
      reply: `Your most sensitive member is the ${context.mostVulnerable} one. Give them one filtered room to retreat to, keep windows shut during peaks, and mask any trips outside. For symptoms, see a clinician.`,
      reasoning,
      proposals: [],
    };
  }
  return {
    reply: `Air in ${context.city} is ${context.airLevel.toLowerCase()} today (AQI ${context.aqi}), with ${open.length} measures still to adopt and ${context.routineCount} routine reminders set. Ask me about your exposure, a measure, or exercise and commuting.`,
    reasoning,
    proposals: [],
  };
}
