import { createPlan } from "../shared/plan";
import { profileSchema, type Plan, type Profile } from "../shared/schemas";

export const TODAY = "2026-11-22";

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    household: "The Sharma family",
    city: "Delhi",
    date: TODAY,
    members: [
      { id: "m1", label: "Me", group: "healthy" },
      { id: "m2", label: "Aarav", group: "child" },
      { id: "m3", label: "Dadi", group: "senior" },
    ],
    home: {
      ventilation: "average",
      cookingFuel: "lpg",
      heating: "none",
      roomSqm: 20,
      nearRoad: true,
      hasPurifier: false,
      purifierCadr: null,
    },
    commuteMode: "car",
    commuteMinutes: 40,
    commuteTime: "08:00",
    outdoorActivity: "moderate",
    outdoorTime: "07:00",
    concerns: ["children", "commute"],
    notes: "We live near a busy road; crop-burning season is underway.",
    language: "en",
    ...overrides,
  });
}

export function makePlan(overrides: Partial<Profile> = {}, today = TODAY): Plan {
  return createPlan(makeProfile(overrides), {
    id: "plan-1",
    today,
    now: "2026-11-22T10:00:00.000Z",
  });
}
