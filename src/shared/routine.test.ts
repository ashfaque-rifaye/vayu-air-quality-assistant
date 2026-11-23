import { describe, expect, it } from "vitest";
import { buildAirQuality, hourlyFromAverage } from "./aqi.js";
import {
  buildRoutine,
  cleanestWindow,
  groupRoutine,
  isSafeToVentilate,
  partOfDay,
  peakWindows,
  UNHEALTHY_PM25,
} from "./routine.js";
import { makeProfile } from "../test/fixtures.js";

const profile = makeProfile();

describe("cleanestWindow", () => {
  it("finds the lowest daytime window", () => {
    const hourly = hourlyFromAverage(180);
    const window = cleanestWindow(hourly);
    expect(window.start).toBeGreaterThanOrEqual(8);
    expect(window.end).toBeLessThanOrEqual(19);
    // It should be at or below the daily mean.
    expect(window.average).toBeLessThanOrEqual(180);
  });
});

describe("peakWindows", () => {
  it("returns contiguous runs above the threshold", () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h >= 7 && h <= 9 ? 120 : 10));
    const peaks = peakWindows(hourly, UNHEALTHY_PM25);
    expect(peaks).toHaveLength(1);
    expect(peaks[0]).toMatchObject({ start: 7, end: 10 });
  });

  it("is empty when the air stays clean", () => {
    expect(peakWindows(hourlyFromAverage(10))).toHaveLength(0);
  });
});

describe("buildRoutine", () => {
  const air = buildAirQuality({ city: "Delhi", source: "model", observedAt: "x" });
  const routine = buildRoutine(profile, air);

  it("is non-empty and time-sorted", () => {
    expect(routine.length).toBeGreaterThan(2);
    const times = routine.map((item) => item.time);
    expect([...times].sort()).toEqual(times);
  });

  it("always opens with a morning air check", () => {
    expect(routine.some((item) => item.category === "monitoring" && item.time === "07:00")).toBe(
      true,
    );
  });

  it("every item carries a reason", () => {
    for (const item of routine) expect(item.why && item.why.length).toBeGreaterThan(0);
  });

  it("tells a heavy-smog day to keep windows shut", () => {
    const hazardous = buildAirQuality({
      city: "Delhi",
      averagePm25: 400,
      source: "manual",
      observedAt: "x",
    });
    const items = buildRoutine(profile, hazardous);
    expect(items.some((item) => /shut/i.test(item.title))).toBe(true);
  });
});

describe("grouping", () => {
  it("buckets by part of day", () => {
    expect(partOfDay("07:00")).toBe("morning");
    expect(partOfDay("14:00")).toBe("afternoon");
    expect(partOfDay("19:00")).toBe("evening");
    expect(partOfDay("23:00")).toBe("night");
    expect(partOfDay("02:00")).toBe("night");
  });

  it("groupRoutine drops empty parts", () => {
    const groups = groupRoutine([
      { id: "a", time: "07:00", title: "x", category: "monitoring", source: "auto" },
      { id: "b", time: "21:00", title: "y", category: "purifier", source: "auto" },
    ]);
    expect(groups.map((g) => g.id)).toEqual(["morning", "evening"]);
  });
});

describe("isSafeToVentilate", () => {
  it("is false when even the cleanest window is unhealthy, true when it is clean", () => {
    expect(isSafeToVentilate(hourlyFromAverage(210))).toBe(false);
    expect(isSafeToVentilate(hourlyFromAverage(20))).toBe(true);
  });

  it("agrees with the routine's own ventilation advice", () => {
    for (const mean of [15, 30, 45, 120, 300]) {
      const air = buildAirQuality({
        city: "Delhi",
        averagePm25: mean,
        source: "manual",
        observedAt: "x",
      });
      const airsOut = buildRoutine(profile, air).some((item) => /air out/i.test(item.title));
      expect(airsOut).toBe(isSafeToVentilate(air.hourly));
    }
  });
});
