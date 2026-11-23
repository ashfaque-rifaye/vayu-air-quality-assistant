import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  aqiBand,
  averageOverHours,
  baselineFor,
  buildAirQuality,
  clampPm25,
  hourlyFromAverage,
  indoorPm25,
  pm25Band,
  pm25ToAqi,
  purifierReduction,
  SMOG_DIURNAL,
  WHO_DAILY_PM25,
} from "./aqi.js";

describe("pm25ToAqi", () => {
  it("maps the standard breakpoints", () => {
    expect(pm25ToAqi(0)).toBe(0);
    expect(pm25ToAqi(12)).toBe(50);
    expect(pm25ToAqi(35.4)).toBe(100);
    expect(pm25ToAqi(55.5)).toBe(151);
    expect(pm25ToAqi(250.5)).toBe(301);
  });

  it("is monotonic non-decreasing in PM2.5", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (a, d) => {
          expect(pm25ToAqi(a + d)).toBeGreaterThanOrEqual(pm25ToAqi(a));
        },
      ),
    );
  });

  it("caps very high values at 500", () => {
    expect(pm25ToAqi(9000)).toBe(500);
  });
});

describe("aqiBand / pm25Band", () => {
  it("names the bands by severity", () => {
    expect(aqiBand(20).level).toBe("good");
    expect(aqiBand(75).level).toBe("moderate");
    expect(aqiBand(120).level).toBe("sensitive");
    expect(aqiBand(180).level).toBe("unhealthy");
    expect(aqiBand(250).level).toBe("very-unhealthy");
    expect(aqiBand(450).level).toBe("hazardous");
  });

  it("derives the band straight from PM2.5", () => {
    expect(pm25Band(5).level).toBe("good");
    expect(pm25Band(300).level).toBe("hazardous");
    expect(pm25Band(200).advice).toMatch(/./);
  });
});

describe("the winter-smog day shape", () => {
  it("averages to exactly 1 across 24 hours", () => {
    const mean = SMOG_DIURNAL.reduce((a, b) => a + b, 0) / 24;
    expect(mean).toBeCloseTo(1, 6);
  });

  it("peaks in the morning and dips in the afternoon", () => {
    expect(SMOG_DIURNAL[8]).toBeGreaterThan(SMOG_DIURNAL[14]!);
  });

  it("preserves the daily mean when spread over hours", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 500, noNaN: true }), (mean) => {
        const hourly = hourlyFromAverage(mean);
        const got = hourly.reduce((a, b) => a + b, 0) / 24;
        expect(got).toBeCloseTo(clampPm25(mean), 0);
      }),
    );
  });
});

describe("baselineFor", () => {
  it("knows winter-smog cities and falls back otherwise", () => {
    expect(baselineFor("Delhi")).toBeGreaterThan(150);
    expect(baselineFor("  LAHORE ")).toBeGreaterThan(200);
    expect(baselineFor("Nowhere City")).toBe(baselineFor("anywhere else"));
  });
});

describe("buildAirQuality", () => {
  it("builds a 24-hour snapshot from a city baseline", () => {
    const air = buildAirQuality({
      city: "Delhi",
      source: "model",
      observedAt: "2026-11-22T00:00:00Z",
    });
    expect(air.hourly).toHaveLength(24);
    expect(air.averagePm25).toBeGreaterThan(100);
    expect(air.source).toBe("model");
  });

  it("honours an override average", () => {
    const air = buildAirQuality({
      city: "Delhi",
      averagePm25: 42,
      source: "manual",
      observedAt: "x",
    });
    expect(air.averagePm25).toBe(42);
  });
});

describe("averageOverHours", () => {
  it("wraps past midnight and averages the window", () => {
    const hourly = Array.from({ length: 24 }, (_, h) => h);
    expect(averageOverHours(hourly, 23, 2)).toBeCloseTo((23 + 0) / 2);
    expect(averageOverHours(hourly, 0, 0)).toBe(0);
  });
});

describe("indoor physics", () => {
  it("a sealed home with a purifier breathes less than a leaky one", () => {
    const leaky = indoorPm25(200, { ventilation: "leaky" });
    const sealed = indoorPm25(200, { ventilation: "sealed", purifierReduction: 0.6 });
    expect(sealed).toBeLessThan(leaky);
  });

  it("adds indoor sources and never goes negative", () => {
    expect(indoorPm25(100, { ventilation: "average", indoorSource: 50 })).toBeGreaterThan(
      indoorPm25(100, { ventilation: "average" }),
    );
    expect(indoorPm25(0, { ventilation: "leaky" })).toBe(0);
  });

  it("purifier reduction rises with CADR and is capped", () => {
    const small = purifierReduction(100, 30);
    const big = purifierReduction(400, 30);
    expect(big).toBeGreaterThan(small);
    expect(purifierReduction(100000, 10)).toBeLessThanOrEqual(0.9);
    expect(purifierReduction(0, 30)).toBe(0);
  });
});

it("exposes the WHO guideline", () => {
  expect(WHO_DAILY_PM25).toBe(15);
});
