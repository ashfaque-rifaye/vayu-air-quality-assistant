/**
 * Air-quality arithmetic. None of this is the model's job: converting PM2.5 to an
 * AQI, shaping a winter-smog day, and working out how much of the outdoor haze
 * actually reaches the lungs indoors are all deterministic, so the numbers the
 * user sees are always exact and always available, even with no network.
 *
 * PM2.5 (fine particles under 2.5 microns) is the pollutant that defines winter
 * smog and the one most tied to health, so the whole model is built on it.
 * Everything is pure: "now" and the city are passed in by the caller.
 */
import type { AirQuality, Ventilation } from "./schemas.js";

/** WHO 2021 guideline for 24-hour mean PM2.5 (micrograms per cubic metre). */
export const WHO_DAILY_PM25 = 15;

/** Highest PM2.5 the model will reason about, so one bad input cannot explode. */
export const MAX_PM25 = 1000;

// --- PM2.5 to US AQI -------------------------------------------------------

interface Breakpoint {
  cLow: number;
  cHigh: number;
  aLow: number;
  aHigh: number;
}

/** EPA piecewise-linear breakpoints for 24-hour PM2.5. */
const PM25_BREAKPOINTS: readonly Breakpoint[] = [
  { cLow: 0, cHigh: 12, aLow: 0, aHigh: 50 },
  { cLow: 12.1, cHigh: 35.4, aLow: 51, aHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, aLow: 101, aHigh: 150 },
  { cLow: 55.5, cHigh: 150.4, aLow: 151, aHigh: 200 },
  { cLow: 150.5, cHigh: 250.4, aLow: 201, aHigh: 300 },
  { cLow: 250.5, cHigh: 350.4, aLow: 301, aHigh: 400 },
  { cLow: 350.5, cHigh: 500.4, aLow: 401, aHigh: 500 },
];

/** Convert a PM2.5 concentration to a US AQI value (0-500), rounded. */
export function pm25ToAqi(pm25: number): number {
  const c = Math.max(0, Math.min(pm25, 500.4));
  const band = PM25_BREAKPOINTS.find((b) => c >= b.cLow && c <= b.cHigh);
  if (!band) return 500;
  const aqi = ((band.aHigh - band.aLow) / (band.cHigh - band.cLow)) * (c - band.cLow) + band.aLow;
  return Math.round(aqi);
}

export type AqiLevel =
  "good" | "moderate" | "sensitive" | "unhealthy" | "very-unhealthy" | "hazardous";

export interface AqiBand {
  level: AqiLevel;
  label: string;
  /** Headline guidance for the general public at this level. */
  advice: string;
}

const AQI_BANDS: readonly (AqiBand & { maxAqi: number })[] = [
  {
    maxAqi: 50,
    level: "good",
    label: "Good",
    advice: "Air quality is clean. Normal outdoor activity is fine.",
  },
  {
    maxAqi: 100,
    level: "moderate",
    label: "Moderate",
    advice: "Acceptable for most. Very sensitive people should watch for symptoms.",
  },
  {
    maxAqi: 150,
    level: "sensitive",
    label: "Unhealthy for sensitive groups",
    advice:
      "Children, older adults and people with heart or lung conditions should limit heavy exertion outdoors.",
  },
  {
    maxAqi: 200,
    level: "unhealthy",
    label: "Unhealthy",
    advice: "Everyone may feel effects. Sensitive groups should stay indoors and run clean air.",
  },
  {
    maxAqi: 300,
    level: "very-unhealthy",
    label: "Very unhealthy",
    advice: "Health alert. Avoid outdoor exertion, keep windows shut and filter indoor air.",
  },
  {
    maxAqi: Infinity,
    level: "hazardous",
    label: "Hazardous",
    advice:
      "Emergency conditions. Stay indoors with filtered air and wear a fitted respirator outside.",
  },
];

export function aqiBand(aqi: number): AqiBand {
  const band = AQI_BANDS.find((b) => aqi <= b.maxAqi) ?? AQI_BANDS[AQI_BANDS.length - 1]!;
  return { level: band.level, label: band.label, advice: band.advice };
}

export function pm25Band(pm25: number): AqiBand {
  return aqiBand(pm25ToAqi(pm25));
}

// --- The shape of a winter-smog day ----------------------------------------

/**
 * Relative PM2.5 through the day under a classic winter inversion: particles are
 * trapped near the ground overnight and in the morning, peak with the morning
 * commute (around 08:00) and again late evening (cooking, traffic and the
 * inversion re-forming), and thin out in the warmer, better-mixed afternoon.
 * Normalised so the 24 values average exactly 1, so scaling by a daily mean
 * preserves that mean.
 */
const RAW_DIURNAL: readonly number[] = [
  1.25, 1.3, 1.28, 1.22, 1.18, 1.2, 1.35, 1.55, 1.6, 1.4, 1.1, 0.9, 0.75, 0.68, 0.65, 0.7, 0.82,
  0.95, 1.1, 1.25, 1.35, 1.42, 1.4, 1.32,
];

export const SMOG_DIURNAL: readonly number[] = (() => {
  const mean = RAW_DIURNAL.reduce((a, b) => a + b, 0) / RAW_DIURNAL.length;
  return RAW_DIURNAL.map((v) => v / mean);
})();

/** Typical November daily-mean PM2.5 for cities in the winter-smog belt. */
export const CITY_BASELINES: Readonly<Record<string, number>> = {
  delhi: 210,
  "new delhi": 210,
  ghaziabad: 235,
  noida: 205,
  gurugram: 195,
  gurgaon: 195,
  faridabad: 215,
  lahore: 250,
  kolkata: 150,
  patna: 200,
  lucknow: 190,
  kanpur: 205,
  dhaka: 190,
  karachi: 130,
  mumbai: 95,
  pune: 90,
  bengaluru: 70,
  bangalore: 70,
  chennai: 65,
  hyderabad: 85,
  kathmandu: 115,
  beijing: 90,
};

const DEFAULT_BASELINE = 140;

/** Best-guess winter daily mean PM2.5 for a city name, falling back to a default. */
export function baselineFor(city: string): number {
  return CITY_BASELINES[city.trim().toLowerCase()] ?? DEFAULT_BASELINE;
}

export function clampPm25(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value * 10) / 10, MAX_PM25);
}

/** Spread a daily-mean PM2.5 across 24 hours using the winter-smog profile. */
export function hourlyFromAverage(average: number): number[] {
  const mean = clampPm25(average);
  return SMOG_DIURNAL.map((factor) => clampPm25(mean * factor));
}

export interface BuildAirOptions {
  city: string;
  /** Override the city baseline with a measured or user-supplied daily mean. */
  averagePm25?: number | undefined;
  source: AirQuality["source"];
  station?: string;
  observedAt: string;
}

/** Assemble a full {@link AirQuality} snapshot, hourly curve included. */
export function buildAirQuality(options: BuildAirOptions): AirQuality {
  const average = clampPm25(options.averagePm25 ?? baselineFor(options.city));
  return {
    source: options.source,
    station: (options.station ?? options.city ?? "").slice(0, 80),
    observedAt: options.observedAt,
    averagePm25: average,
    hourly: hourlyFromAverage(average),
  };
}

/** Mean outdoor PM2.5 across a run of hours (wraps past midnight). */
export function averageOverHours(
  hourly: readonly number[],
  startHour: number,
  hours: number,
): number {
  if (hours <= 0 || hourly.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < Math.min(hours, 24); i += 1) {
    const h = (((startHour + i) % 24) + 24) % 24;
    sum += hourly[h] ?? 0;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

// --- How much outdoor haze reaches the lungs indoors -----------------------

/**
 * Fraction of outdoor PM2.5 that seeps into a closed home. A tighter, sealed home
 * keeps more out; a leaky one barely helps. These are mid-range values for homes
 * with windows shut, which is the winter-smog assumption.
 */
export const INFILTRATION: Readonly<Record<Ventilation, number>> = {
  sealed: 0.4,
  average: 0.6,
  leaky: 0.85,
};

export interface IndoorOptions {
  ventilation: Ventilation;
  /** 0-1 reduction from a running air purifier sized for the room. */
  purifierReduction?: number;
  /** PM2.5 added indoors by sources such as a wood or kerosene stove. */
  indoorSource?: number;
}

/**
 * Indoor PM2.5 from the outdoor level: what infiltrates, plus indoor sources,
 * less what a purifier removes. Never negative.
 */
export function indoorPm25(outdoor: number, options: IndoorOptions): number {
  const infiltrated = Math.max(0, outdoor) * INFILTRATION[options.ventilation];
  const withSource = infiltrated + Math.max(0, options.indoorSource ?? 0);
  const afterPurifier =
    withSource * (1 - Math.min(0.95, Math.max(0, options.purifierReduction ?? 0)));
  return clampPm25(afterPurifier);
}

/**
 * Clean-air reduction a purifier delivers, from its CADR against the room.
 * A device that turns over the room's air more times per hour removes more; the
 * curve flattens because no filter reaches zero in a leaky, re-polluting room.
 */
export function purifierReduction(cadrM3PerHour: number, roomSqm: number, ceilingM = 2.7): number {
  if (cadrM3PerHour <= 0 || roomSqm <= 0) return 0;
  const airChangesPerHour = cadrM3PerHour / (roomSqm * ceilingM);
  // Saturating curve: ~0.5 at 2 ACH, ~0.75 at 5 ACH, approaching but never 0.9.
  return Math.min(0.9, (airChangesPerHour / (airChangesPerHour + 2)) * 1.1);
}
