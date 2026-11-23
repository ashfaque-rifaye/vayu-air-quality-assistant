/**
 * Build the minimal view of a plan that is sent to the AI.
 *
 * This is the privacy boundary: member names and anything identifying are left
 * out, so only the groups and the situation the model needs to tailor advice ever
 * leave the browser.
 */
import { pm25Band, pm25ToAqi } from "./aqi.js";
import { planExposure } from "./exposure.js";
import { detectRisks, mostVulnerable } from "./insights.js";
import { cleanestWindow, isSafeToVentilate, peakWindows } from "./routine.js";
import type { AirContext, PlanContext } from "./contracts.js";
import type { AirQuality, Plan, Profile, SensitivityGroup } from "./schemas.js";

const GROUP_LABEL: Record<SensitivityGroup, string> = {
  healthy: "Adult",
  child: "Child",
  senior: "Older adult",
  respiratory: "Person with a breathing condition",
  heart: "Person with a heart condition",
  pregnant: "Pregnant person",
};

/**
 * The household profile as the AI may see it: each member's name is replaced by
 * their group ("Child", "Older adult 2"). The model needs who is vulnerable, not
 * who they are. Every feature that sends a profile goes through this.
 */
export function profileForAi(profile: Profile): Profile {
  const seen = new Map<string, number>();
  return {
    ...profile,
    members: profile.members.map((member, index) => {
      const base = GROUP_LABEL[member.group];
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return {
        id: `member-${index + 1}`,
        label: count > 1 ? `${base} ${count}` : base,
        group: member.group,
      };
    }),
  };
}

function hourLabel(hour: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, "0")}:00`;
}

/** The compact air snapshot several prompts share. */
export function buildAirContext(air: AirQuality): AirContext {
  const clean = cleanestWindow(air.hourly);
  const peaks = peakWindows(air.hourly);
  const peakHours = peaks.reduce((sum, w) => sum + (w.end - w.start), 0);
  return {
    averagePm25: Math.round(air.averagePm25),
    aqi: pm25ToAqi(air.averagePm25),
    level: pm25Band(air.averagePm25).label,
    cleanestFrom: hourLabel(clean.start),
    cleanestTo: hourLabel(clean.end),
    cleanestPm25: Math.round(clean.average),
    safeToVentilate: isSafeToVentilate(air.hourly),
    peakHours,
  };
}

export function buildPlanContext(plan: Plan, today: string): PlanContext {
  const { profile, air } = plan;
  const exposure = planExposure(plan);
  return {
    today,
    city: profile.city,
    household: profile.household,
    date: profile.date,
    language: profile.language,
    averagePm25: Math.round(air.averagePm25),
    aqi: pm25ToAqi(air.averagePm25),
    airLevel: pm25Band(air.averagePm25).label,
    safeToVentilate: isSafeToVentilate(air.hourly),
    memberGroups: profile.members.map((member) => member.group),
    mostVulnerable: mostVulnerable(plan),
    exposureNow: exposure.totalDose,
    exposureBaseline: exposure.baselineDose,
    exposureProtected: exposure.protectedDose,
    timesTarget: exposure.timesTarget,
    measures: plan.measures
      .slice(0, 30)
      .map(({ id, label, category, status }) => ({ id, label, category, status })),
    routineCount: plan.routine.length,
    concerns: profile.concerns,
    risks: detectRisks(plan)
      .slice(0, 8)
      .map((risk) => risk.title),
    notes: profile.notes,
  };
}
