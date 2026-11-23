/**
 * Deterministic plan health: a protection score, explainable risks, and the next
 * best measures.
 *
 * None of this needs a model, because it is reasoning over the household's own
 * data and the forecast, and it must stay correct when no model is available.
 * Each risk carries a "why" and a place to fix it, so the score is explainable
 * rather than a mystery number.
 */
import { pm25Band } from "./aqi.js";
import { adoptedCategories, measureImpact, planExposure } from "./exposure.js";
import { UNHEALTHY_PM25 } from "./routine.js";
import type { Measure, Plan, SensitivityGroup } from "./schemas.js";

export type PlanTab = "overview" | "exposure" | "routine" | "measures" | "swaps" | "assistant";

export interface Risk {
  id: string;
  severity: "high" | "medium";
  title: string;
  why: string;
  tab: PlanTab;
}

export interface Protection {
  score: number;
  protectionPart: number;
  measuresPart: number;
  safetyPart: number;
  measuresDone: number;
  measuresTotal: number;
  doseNow: number;
  doseBaseline: number;
  doseProtected: number;
}

const WEIGHT = { protection: 0.5, measures: 0.3, safety: 0.2 } as const;

const VULNERABILITY: Record<SensitivityGroup, number> = {
  healthy: 0,
  senior: 2,
  pregnant: 2,
  child: 3,
  respiratory: 3,
  heart: 3,
};

export function mostVulnerable(plan: Pick<Plan, "profile">): SensitivityGroup {
  return (
    [...plan.profile.members].sort((a, b) => VULNERABILITY[b.group] - VULNERABILITY[a.group])[0]
      ?.group ?? "healthy"
  );
}

function hasVulnerableMember(plan: Pick<Plan, "profile">): boolean {
  return plan.profile.members.some((member) => VULNERABILITY[member.group] >= 2);
}

function activeMeasures(measures: readonly Measure[]): Measure[] {
  return measures.filter((measure) => measure.status !== "dismissed");
}

export function computeProtection(plan: Plan): Protection {
  const exposure = planExposure(plan);
  const active = activeMeasures(plan.measures);
  const done = active.filter((measure) => measure.status === "done").length;

  const protectionPart =
    exposure.reductionPossible > 0 ? exposure.reductionAchieved / exposure.reductionPossible : 1;
  const measuresPart = active.length > 0 ? done / active.length : 1;
  const safetyPart = exposure.over ? Math.max(0, exposure.targetDose / exposure.totalDose) : 1;

  const score = Math.round(
    100 *
      (WEIGHT.protection * protectionPart +
        WEIGHT.measures * measuresPart +
        WEIGHT.safety * safetyPart),
  );

  return {
    score,
    protectionPart,
    measuresPart,
    safetyPart,
    measuresDone: done,
    measuresTotal: active.length,
    doseNow: exposure.totalDose,
    doseBaseline: exposure.baselineDose,
    doseProtected: exposure.protectedDose,
  };
}

function hourPm(plan: Pick<Plan, "air">, time: string): number {
  const hour = Math.max(0, Math.min(23, Number.parseInt(time.slice(0, 2), 10) || 0));
  return plan.air.hourly[hour] ?? plan.air.averagePm25;
}

const OPEN_AIR_COMMUTES = new Set(["walk", "cycle", "motorbike", "bus"]);

export function detectRisks(plan: Plan): Risk[] {
  const risks: Risk[] = [];
  const adopted = adoptedCategories(plan);
  const exposure = planExposure(plan);
  const dayBand = pm25Band(plan.air.averagePm25);
  const unhealthyDay =
    dayBand.level === "unhealthy" ||
    dayBand.level === "very-unhealthy" ||
    dayBand.level === "hazardous";
  const { profile } = plan;

  if (
    profile.outdoorActivity !== "none" &&
    !adopted.has("exercise") &&
    hourPm(plan, profile.outdoorTime) >= UNHEALTHY_PM25
  ) {
    risks.push({
      id: "exercise-in-peak",
      severity: "high",
      title: "A hard workout is scheduled in the smog peak",
      why: `Air at ${profile.outdoorTime} is about ${Math.round(hourPm(plan, profile.outdoorTime))} µg/m³, and breathing hard multiplies the dose. Move it indoors or to the clean window.`,
      tab: "routine",
    });
  }

  if (
    profile.commuteMode !== "none" &&
    OPEN_AIR_COMMUTES.has(profile.commuteMode) &&
    !adopted.has("masks") &&
    hourPm(plan, profile.commuteTime) >= UNHEALTHY_PM25
  ) {
    risks.push({
      id: "commute-unmasked",
      severity: "high",
      title: "The commute is unmasked in heavy smog",
      why: `The ${profile.commuteMode} trip at ${profile.commuteTime} is in open air at about ${Math.round(hourPm(plan, profile.commuteTime))} µg/m³. A fitted N95 removes most of it.`,
      tab: "measures",
    });
  }

  if (hasVulnerableMember(plan) && unhealthyDay && !adopted.has("purifier")) {
    risks.push({
      id: "vulnerable-no-purifier",
      severity: "high",
      title: "A sensitive member has no clean indoor air",
      why: `Someone in the home is more at risk, the air is ${dayBand.label.toLowerCase()}, and no purifier is running. The bedroom is the place to start.`,
      tab: "measures",
    });
  }

  if (["wood", "kerosene"].includes(profile.home.cookingFuel) && !adopted.has("cooking")) {
    risks.push({
      id: "dirty-cooking",
      severity: "high",
      title: "Cooking burns fuel indoors",
      why: `A ${profile.home.cookingFuel} stove often adds more PM2.5 indoors than the smog outside. Clean fuel and extraction is the biggest indoor win here.`,
      tab: "measures",
    });
  }

  if (["wood", "kerosene"].includes(profile.home.heating) && !adopted.has("heating")) {
    risks.push({
      id: "dirty-heating",
      severity: "high",
      title: "Heating burns fuel indoors",
      why: `A ${profile.home.heating} heater is a heavy indoor particle source through the winter. Electric or sealed-flue heat avoids it.`,
      tab: "measures",
    });
  }

  if (profile.home.ventilation === "leaky" && !adopted.has("sealing") && unhealthyDay) {
    risks.push({
      id: "leaky-home",
      severity: "medium",
      title: "Smog leaks straight into the home",
      why: "A leaky home lets most of the outdoor haze in, so a purifier can never get ahead of the room. Sealing comes first.",
      tab: "measures",
    });
  }

  if (exposure.timesTarget >= 3 && exposure.reductionAchieved < exposure.reductionPossible * 0.25) {
    risks.push({
      id: "exposure-high",
      severity: "medium",
      title: `Today's exposure is about ${exposure.timesTarget}x the safe target`,
      why: "Most of the protection on offer is not in place yet. Adopting the top measures closes the gap fast.",
      tab: "exposure",
    });
  }

  return risks.sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high"));
}

export interface NextMeasure {
  id: string;
  label: string;
  impact: number;
}

/** The measures that are not yet done, ordered by how much exposure each removes. */
export function nextMeasures(plan: Plan, limit = 3): NextMeasure[] {
  const base = { profile: plan.profile, home: plan.profile.home, air: plan.air };
  return plan.measures
    .filter((measure) => measure.status !== "done" && measure.status !== "dismissed")
    .map((measure) => ({
      id: measure.id,
      label: measure.label,
      impact: measureImpact(measure.category, base),
    }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, limit);
}

export function scoreLabel(score: number): string {
  if (score >= 80) return "Well protected";
  if (score >= 55) return "Partly protected";
  if (score >= 30) return "Lightly protected";
  return "Exposed";
}
