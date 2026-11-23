import { describe, expect, it } from "vitest";
import { csvCell, exposureToCsv, planToJson, routineToIcs } from "./exports.js";
import { planSchema } from "./schemas.js";
import { makePlan } from "../test/fixtures.js";

describe("csvCell", () => {
  it("neutralises formula injection and quotes separators", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvCell(42)).toBe("42");
  });
});

describe("exposureToCsv", () => {
  const csv = exposureToCsv(makePlan());
  it("has a header and the comparison rows", () => {
    expect(csv).toMatch(/^Segment,Place,Hours/);
    expect(csv).toMatch(/Total \(now\)/);
    expect(csv).toMatch(/Doing nothing/);
    expect(csv).toMatch(/Safe target/);
  });
});

describe("routineToIcs", () => {
  const ics = routineToIcs(makePlan(), "2026-11-22T10:00:00.000Z");
  it("is a well-formed calendar with timed events", () => {
    expect(ics).toMatch(/BEGIN:VCALENDAR/);
    expect(ics).toMatch(/PRODID:-\/\/Vayu/);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBeGreaterThan(0);
    expect(ics).toMatch(/DTSTART:20261122T\d{6}/);
    expect(ics.endsWith("\r\n")).toBe(true);
  });
});

describe("planToJson", () => {
  it("round-trips through the schema", () => {
    const plan = makePlan();
    const parsed = planSchema.safeParse(JSON.parse(planToJson(plan)));
    expect(parsed.success).toBe(true);
  });
});
