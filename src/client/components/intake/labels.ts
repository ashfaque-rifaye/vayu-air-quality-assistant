/** Human labels for every choice on the intake form, and the example descriptions. */
import type {
  ActivityLevel,
  CommuteMode,
  Concern,
  CookingFuel,
  HeatingType,
  SensitivityGroup,
  Ventilation,
} from "../../../shared/schemas";

export const SENSITIVITY_LABELS: Record<SensitivityGroup, string> = {
  healthy: "Healthy adult",
  child: "Child (under 12)",
  senior: "Older adult (65+)",
  respiratory: "Asthma / lung condition",
  heart: "Heart condition",
  pregnant: "Pregnant",
};

export const VENTILATION_LABELS: Record<Ventilation, string> = {
  sealed: "Sealed / airtight",
  average: "Average",
  leaky: "Leaky / draughty",
};

export const FUEL_LABELS: Record<CookingFuel, string> = {
  induction: "Induction",
  lpg: "LPG",
  gas: "Piped gas",
  wood: "Wood / biomass",
  kerosene: "Kerosene",
};

export const HEATING_LABELS: Record<HeatingType, string> = {
  none: "None",
  electric: "Electric",
  gas: "Gas",
  wood: "Wood / kerosene",
};

export const COMMUTE_LABELS: Record<CommuteMode, string> = {
  none: "I stay home",
  walk: "Walk",
  cycle: "Cycle",
  metro: "Metro / train",
  bus: "Bus",
  car: "Car",
  motorbike: "Motorbike / scooter",
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  none: "None",
  light: "Light (a walk)",
  moderate: "Moderate (brisk)",
  intense: "Intense (run / cycle)",
};

export const CONCERN_LABELS: Record<Concern, string> = {
  children: "Children",
  elderly: "Elderly",
  exercise: "Exercise",
  commute: "Commute",
  cooking: "Cooking",
  sleep: "Sleep",
  budget: "Budget",
};

export const EXAMPLES: readonly { label: string; text: string }[] = [
  {
    label: "Delhi family",
    text: "We're a family of four in Delhi near a main road. My son has asthma. We cook on LPG, have no air purifier, and I cycle to work at 8am.",
  },
  {
    label: "Lahore couple",
    text: "An elderly couple in Lahore. We heat with a wood stove and my wife has a heart condition. We rarely go out but worry about the smog indoors.",
  },
  {
    label: "Patna, new baby",
    text: "Young family in Patna with a toddler, a kerosene stove and leaky old windows. We want to protect the baby through smog season on a tight budget.",
  },
];
