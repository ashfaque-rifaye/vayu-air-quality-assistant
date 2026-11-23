/**
 * Domain schemas: the single source of truth for what an air-quality plan is.
 *
 * The same schemas validate form input, localStorage reads, imported backups and
 * API payloads, so a plan cannot enter the app through any door without passing
 * the same checks. Every string and array is bounded to cap memory and tokens.
 */
import { z } from "zod";
import { isIsoDate } from "./dates.js";

export const LANGUAGES = ["en", "hi", "ur", "bn", "ta", "pa"] as const;

/** Who shares the home. The most sensitive member sets the protection target. */
export const SENSITIVITY_GROUPS = [
  "healthy",
  "child",
  "senior",
  "respiratory",
  "heart",
  "pregnant",
] as const;

export const VENTILATION = ["sealed", "average", "leaky"] as const;
export const COOKING_FUELS = ["induction", "lpg", "gas", "wood", "kerosene"] as const;
export const HEATING_TYPES = ["none", "electric", "gas", "wood"] as const;
export const COMMUTE_MODES = ["none", "walk", "cycle", "metro", "bus", "car", "motorbike"] as const;
export const ACTIVITY_LEVELS = ["none", "light", "moderate", "intense"] as const;

/** What the household cares about most. Weights the protection score and tailoring. */
export const CONCERNS = [
  "children",
  "elderly",
  "exercise",
  "commute",
  "cooking",
  "sleep",
  "budget",
] as const;

/** Categories of mitigation. Shared by measures and by the concern weighting. */
export const MEASURE_CATEGORIES = [
  "purifier",
  "masks",
  "sealing",
  "ventilation",
  "cooking",
  "commute",
  "exercise",
  "monitoring",
  "plants",
  "heating",
] as const;

export const MEASURE_STATUSES = ["suggested", "planned", "done", "dismissed"] as const;

export type Language = (typeof LANGUAGES)[number];
export type SensitivityGroup = (typeof SENSITIVITY_GROUPS)[number];
export type Ventilation = (typeof VENTILATION)[number];
export type CookingFuel = (typeof COOKING_FUELS)[number];
export type HeatingType = (typeof HEATING_TYPES)[number];
export type CommuteMode = (typeof COMMUTE_MODES)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];
export type Concern = (typeof CONCERNS)[number];
export type MeasureCategory = (typeof MEASURE_CATEGORIES)[number];
export type MeasureStatus = (typeof MEASURE_STATUSES)[number];

const MAX_PM25 = 1000;
const MAX_MEMBERS = 12;
const MAX_ROOM_SQM = 2000;
const MAX_CADR = 2000;
const MAX_COMMUTE_MIN = 600;
const MAX_COST = 10_000_000;
export const MAX_CONCERNS = 3;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isoDateSchema = z.string().refine(isIsoDate, "Enter a valid date");
export const timeSchema = z.string().regex(TIME_RE, "Use 24-hour HH:MM");
const costSchema = z.number().finite().min(0).max(MAX_COST);
const pm25Schema = z.number().finite().min(0).max(MAX_PM25);

export const memberSchema = z.object({
  id: z.string().max(40),
  label: z.string().trim().min(1, "Name this person").max(40),
  group: z.enum(SENSITIVITY_GROUPS),
});
export type Member = z.infer<typeof memberSchema>;

export const homeSchema = z.object({
  ventilation: z.enum(VENTILATION).default("average"),
  cookingFuel: z.enum(COOKING_FUELS).default("lpg"),
  heating: z.enum(HEATING_TYPES).default("none"),
  /** Floor area of the main room a purifier would serve, in square metres. */
  roomSqm: z.number().int().min(4).max(MAX_ROOM_SQM).default(20),
  nearRoad: z.boolean().default(false),
  hasPurifier: z.boolean().default(false),
  purifierCadr: z.number().min(0).max(MAX_CADR).nullable().default(null),
});
export type Home = z.infer<typeof homeSchema>;

export const profileSchema = z.object({
  household: z.string().trim().min(1, "Give your household a name").max(80),
  city: z.string().trim().min(1, "Enter your city").max(80),
  date: isoDateSchema,
  members: z.array(memberSchema).min(1, "Add at least one person").max(MAX_MEMBERS),
  home: homeSchema,
  commuteMode: z.enum(COMMUTE_MODES).default("none"),
  commuteMinutes: z.number().int().min(0).max(MAX_COMMUTE_MIN).default(0),
  /** When the daily commute leaves home, 24-hour HH:MM. */
  commuteTime: timeSchema.default("09:00"),
  outdoorActivity: z.enum(ACTIVITY_LEVELS).default("none"),
  /** When the household usually exercises or spends time outdoors. */
  outdoorTime: timeSchema.default("07:00"),
  concerns: z.array(z.enum(CONCERNS)).max(MAX_CONCERNS).default([]),
  notes: z.string().trim().max(600).default(""),
  language: z.enum(LANGUAGES).default("en"),
});
export type Profile = z.infer<typeof profileSchema>;

export const airQualitySchema = z.object({
  source: z.enum(["model", "manual", "live"]),
  station: z.string().max(80),
  observedAt: z.string().max(40),
  averagePm25: pm25Schema,
  hourly: z.array(pm25Schema).length(24),
});
export type AirQuality = z.infer<typeof airQualitySchema>;

const measureSourceSchema = z.enum(["template", "ai", "you"]);

export const measureGuideSchema = z.object({
  whatToLookFor: z.array(z.string().max(300)).max(8),
  redFlags: z.array(z.string().max(300)).max(6),
  tip: z.string().max(400),
  reasoning: z.string().max(400),
});
export type MeasureGuide = z.infer<typeof measureGuideSchema>;

export const measureSchema = z.object({
  id: z.string().max(40),
  category: z.enum(MEASURE_CATEGORIES),
  label: z.string().trim().min(1).max(100),
  status: z.enum(MEASURE_STATUSES),
  /** Estimated one-off cost, or null when a measure is free or behavioural. */
  cost: costSchema.nullable(),
  effortDays: z.number().int().min(0).max(365),
  notes: z.string().max(400),
  source: measureSourceSchema,
  why: z.string().max(300).optional(),
  guide: measureGuideSchema.optional(),
  checks: z
    .array(z.object({ id: z.string().max(40), label: z.string().max(160), done: z.boolean() }))
    .max(12),
});
export type Measure = z.infer<typeof measureSchema>;

export const swapSchema = z.object({
  id: z.string().max(40),
  title: z.string().max(120),
  description: z.string().max(500),
  category: z.string().max(40),
  /** Direct impact, quantified: avoided emissions and avoided inhaled exposure. */
  co2eKgPerWeek: z.number().min(0).max(100_000),
  exposureReductionPerDay: z.number().min(0).max(1_000_000),
  why: z.string().max(300),
  saved: z.boolean(),
});
export type Swap = z.infer<typeof swapSchema>;

const routineSourceSchema = z.enum(["auto", "ai", "you"]);

export const routineItemSchema = z.object({
  id: z.string().max(40),
  time: timeSchema,
  title: z.string().trim().min(1).max(160),
  why: z.string().max(300).optional(),
  category: z.enum(MEASURE_CATEGORIES),
  source: routineSourceSchema,
});
export type RoutineItem = z.infer<typeof routineItemSchema>;

export const daySheetItemSchema = z.object({
  time: timeSchema,
  title: z.string().max(160),
  note: z.string().max(200),
});
export type DaySheetItem = z.infer<typeof daySheetItemSchema>;

/**
 * Changes the assistant may *propose*. They are data, applied only after the
 * user approves, and every one passes through the plan reducer's own checks.
 */
export const planProposalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addMeasure"),
    label: z.string().trim().min(1).max(100),
    // An empty or unknown category from the model means "none fits".
    category: z.enum(MEASURE_CATEGORIES).nullable().catch(null),
    why: z.string().max(300),
  }),
  z.object({
    type: z.literal("addRoutineItem"),
    time: timeSchema,
    title: z.string().trim().min(1).max(160),
    why: z.string().max(300),
    // Missing or unknown (and older saved plans) fall back to a general check.
    category: z.enum(MEASURE_CATEGORIES).catch("monitoring"),
  }),
  z.object({
    type: z.literal("adoptMeasure"),
    measureId: z.string().max(40),
    why: z.string().max(300),
  }),
]);
export type PlanProposal = z.infer<typeof planProposalSchema>;

export const aiSourceSchema = z.enum(["gemini", "fireworks", "fallback"]);
export type AiSource = z.infer<typeof aiSourceSchema>;

export const chatMessageSchema = z.object({
  id: z.string().max(40),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(2000),
  reasoning: z.string().max(400).optional(),
  source: aiSourceSchema.optional(),
  proposals: z.array(planProposalSchema).max(4).optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

const personalizationSchema = z.object({
  summary: z.string().max(600),
  reasoning: z.string().max(400),
  source: aiSourceSchema,
});
export type Personalization = z.infer<typeof personalizationSchema>;

export const exposureMoveSchema = z.object({
  measureId: z.string().max(40),
  why: z.string().max(300),
});
export type ExposureMove = z.infer<typeof exposureMoveSchema>;

const exposureReviewSchema = z.object({
  advice: z.array(z.object({ title: z.string().max(120), detail: z.string().max(400) })).max(5),
  moves: z.array(exposureMoveSchema).max(4),
  reasoning: z.string().max(400),
  source: aiSourceSchema,
});
export type ExposureReview = z.infer<typeof exposureReviewSchema>;

export const PLAN_VERSION = 1;

export const planSchema = z.object({
  version: z.literal(PLAN_VERSION),
  id: z.string().min(1).max(64),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  /** Counter for ids minted by the reducer, which keeps the reducer pure. */
  seq: z.number().int().min(0),
  profile: profileSchema,
  air: airQualitySchema,
  measures: z.array(measureSchema).max(60),
  routine: z.array(routineItemSchema).max(60),
  swaps: z.array(swapSchema).max(60),
  daySheet: z.array(daySheetItemSchema).max(40),
  chat: z.array(chatMessageSchema).max(200),
  personalization: personalizationSchema.nullable(),
  review: exposureReviewSchema.nullable(),
});
export type Plan = z.infer<typeof planSchema>;
