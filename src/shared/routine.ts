/**
 * The daily routine: turn the hour-by-hour smog forecast into a plan for the day.
 *
 * All of it is deterministic reasoning over the AQI curve and the household's own
 * habits, so it is correct and available with no model. The AI "day-sheet" layers
 * a tailored narrative on top; the routine itself never depends on it.
 */
import { averageOverHours, pm25ToAqi } from "./aqi.js";
import type { AirQuality, MeasureCategory, Profile, RoutineItem } from "./schemas.js";

/** Above this PM2.5 the air is unhealthy for everyone (US AQI ~150+). */
export const UNHEALTHY_PM25 = 55.4;
/** Above this PM2.5 sensitive groups should take care (US AQI ~100+). */
export const SENSITIVE_PM25 = 35.4;

export interface HourWindow {
  start: number;
  end: number;
  average: number;
}

function hourLabel(hour: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, "0")}:00`;
}

function hourOf(time: string): number {
  return Math.max(0, Math.min(23, Number.parseInt(time.slice(0, 2), 10) || 0));
}

/** The calmest run of `length` hours to open the windows, searched over daytime. */
export function cleanestWindow(
  hourly: readonly number[],
  length = 2,
  from = 8,
  to = 18,
): HourWindow {
  let best: HourWindow = { start: from, end: from + length, average: Infinity };
  for (let start = from; start + length <= to + 1; start += 1) {
    const average = averageOverHours(hourly, start, length);
    if (average < best.average) best = { start, end: start + length, average };
  }
  return best;
}

/**
 * Whether opening the windows ever helps today: only if the cleanest daytime
 * window drops to a level that is safe for sensitive groups. One rule, shared by
 * the routine and by what the AI is told, so the two can never disagree.
 */
export function isSafeToVentilate(hourly: readonly number[]): boolean {
  return cleanestWindow(hourly).average <= SENSITIVE_PM25;
}

/** Contiguous windows where outdoor PM2.5 stays at or above a threshold. */
export function peakWindows(hourly: readonly number[], threshold = UNHEALTHY_PM25): HourWindow[] {
  const windows: HourWindow[] = [];
  let start: number | null = null;
  let sum = 0;
  let count = 0;
  for (let h = 0; h <= 24; h += 1) {
    const value = h < 24 ? (hourly[h] ?? 0) : -1;
    if (value >= threshold) {
      if (start === null) {
        start = h;
        sum = 0;
        count = 0;
      }
      sum += value;
      count += 1;
    } else if (start !== null) {
      windows.push({ start, end: h, average: count > 0 ? sum / count : 0 });
      start = null;
    }
  }
  return windows;
}

/**
 * Build the recommended routine for the plan's day from the forecast and habits.
 * Every item carries a why, so the routine is explainable rather than a list of
 * orders.
 */
export function buildRoutine(
  profile: Pick<
    Profile,
    "commuteMode" | "commuteTime" | "outdoorActivity" | "outdoorTime" | "home" | "members"
  > & { home: Profile["home"] },
  air: AirQuality,
): RoutineItem[] {
  const hourly = air.hourly;
  const items: { time: string; title: string; why: string; category: MeasureCategory }[] = [];
  const dayAverage = air.averagePm25;
  const unhealthy = peakWindows(hourly, UNHEALTHY_PM25);
  const clean = cleanestWindow(hourly);

  items.push({
    time: "07:00",
    title: "Check today's air before anyone goes out",
    why: `The daily mean is about ${Math.round(dayAverage)} µg/m³ (AQI ${pm25ToAqi(dayAverage)}), so plan the day around the peaks.`,
    category: "monitoring",
  });

  if (isSafeToVentilate(hourly)) {
    items.push({
      time: hourLabel(clean.start),
      title: `Air out the home ${hourLabel(clean.start)}-${hourLabel(clean.end)}`,
      why: `This is the cleanest stretch today (about ${Math.round(clean.average)} µg/m³). Ventilate now, then close up.`,
      category: "ventilation",
    });
  } else {
    items.push({
      time: "09:00",
      title: "Keep windows shut today",
      why: "Outdoor air never clears to a safe level today, so opening up lets smog in.",
      category: "ventilation",
    });
  }

  // Commute: shift it toward cleaner air, and mask up if it falls in a peak.
  if (profile.commuteMode !== "none") {
    const commuteHour = hourOf(profile.commuteTime);
    const commutePm = hourly[commuteHour] ?? dayAverage;
    if (commutePm >= UNHEALTHY_PM25) {
      items.push({
        time: hourLabel(commuteHour),
        title: "Wear a fitted N95 on the commute",
        why: `Air at ${hourLabel(commuteHour)} is about ${Math.round(commutePm)} µg/m³. A sealed N95 cuts most of what you breathe in.`,
        category: "masks",
      });
    }
  }

  // Outdoor exercise: move it to the cleanest window, or indoors on a bad day.
  if (profile.outdoorActivity !== "none") {
    const exerciseHour = hourOf(profile.outdoorTime);
    const exercisePm = hourly[exerciseHour] ?? dayAverage;
    if (exercisePm >= UNHEALTHY_PM25 && clean.average >= UNHEALTHY_PM25) {
      items.push({
        time: hourLabel(exerciseHour),
        title: "Train indoors today",
        why: "Every hour outdoors is unhealthy today, and hard breathing multiplies the dose. Keep the workout inside.",
        category: "exercise",
      });
    } else if (exercisePm > clean.average + 15) {
      items.push({
        time: hourLabel(clean.start),
        title: `Move exercise to ${hourLabel(clean.start)}`,
        why: `Your usual ${hourLabel(exerciseHour)} slot is about ${Math.round(exercisePm)} µg/m³ versus ${Math.round(clean.average)} in the clean window.`,
        category: "exercise",
      });
    }
  }

  // Purifier through the worst air and overnight for the bedroom.
  if (unhealthy.length > 0) {
    items.push({
      time: "21:00",
      title: profile.home.hasPurifier
        ? "Run the bedroom purifier overnight"
        : "Filter the bedroom air overnight",
      why: "The evening peak and the overnight inversion are the longest high-exposure stretch, and it is when the household sleeps.",
      category: "purifier",
    });
  }

  // Cooking on a dirty fuel vents particles straight into the home.
  if (profile.home.cookingFuel === "wood" || profile.home.cookingFuel === "kerosene") {
    items.push({
      time: "19:00",
      title: "Vent the kitchen hard while cooking",
      why: `A ${profile.home.cookingFuel} stove adds more PM2.5 indoors than the smog outside. Extract it and keep the door shut to the rest of the home.`,
      category: "cooking",
    });
  }

  // Close up before the evening inversion.
  items.push({
    time: "18:00",
    title: "Close windows before the evening peak",
    why: "PM2.5 climbs sharply from early evening as the air cools and traps pollution near the ground.",
    category: "ventilation",
  });

  return items
    .map((item, index): RoutineItem => ({
      id: `routine-${index + 1}`,
      time: item.time,
      title: item.title,
      why: item.why,
      category: item.category,
      source: "auto",
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export const DAY_PARTS = [
  { id: "morning", label: "Morning", from: 5, to: 11 },
  { id: "afternoon", label: "Afternoon", from: 12, to: 16 },
  { id: "evening", label: "Evening", from: 17, to: 21 },
  { id: "night", label: "Night", from: 22, to: 28 },
] as const;

export type DayPartId = (typeof DAY_PARTS)[number]["id"];

export function partOfDay(time: string): DayPartId {
  const hour = hourOf(time);
  const normalised = hour < 5 ? hour + 24 : hour;
  const part = DAY_PARTS.find((p) => normalised >= p.from && normalised <= p.to);
  return part?.id ?? "night";
}

export interface RoutineGroup {
  id: DayPartId;
  label: string;
  items: RoutineItem[];
}

/** Group routine items by part of day, dropping parts with nothing in them. */
export function groupRoutine(items: readonly RoutineItem[]): RoutineGroup[] {
  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));
  return DAY_PARTS.map((part) => ({
    id: part.id,
    label: part.label,
    items: sorted.filter((item) => partOfDay(item.time) === part.id),
  })).filter((group) => group.items.length > 0);
}
