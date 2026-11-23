/**
 * The typed contract between the browser and the AI endpoint.
 *
 * Input and output schemas for every AI feature live here and are shared by both
 * sides: the server validates requests and model output against them, and the
 * client validates responses, so the wire format has one definition.
 */
import { z } from "zod";
import {
  ACTIVITY_LEVELS,
  aiSourceSchema,
  chatMessageSchema,
  COMMUTE_MODES,
  CONCERNS,
  COOKING_FUELS,
  daySheetItemSchema,
  exposureMoveSchema,
  HEATING_TYPES,
  isoDateSchema,
  LANGUAGES,
  MEASURE_CATEGORIES,
  MEASURE_STATUSES,
  measureGuideSchema,
  planProposalSchema,
  profileSchema,
  SENSITIVITY_GROUPS,
  timeSchema,
  VENTILATION,
} from "./schemas.js";

export const MAX_INTERPRET_TEXT = 1000;
export const MAX_CHAT_TEXT = 500;
export const MAX_CHAT_HISTORY = 8;

/** A compact snapshot of the air, shared by several prompts. */
export const airContextSchema = z.object({
  averagePm25: z.number().min(0),
  aqi: z.number().int().min(0),
  level: z.string().max(40),
  cleanestFrom: timeSchema,
  cleanestTo: timeSchema,
  /** Mean PM2.5 in the cleanest window, so the model knows how clean "clean" is. */
  cleanestPm25: z.number().min(0),
  /** Computed by the same rule as the routine; the model must not contradict it. */
  safeToVentilate: z.boolean(),
  peakHours: z.number().int().min(0).max(24),
});
export type AirContext = z.infer<typeof airContextSchema>;

/**
 * The only view of a plan the model ever sees. It carries member *groups*, never
 * names, and no contact details, so personal data stays in the browser.
 */
export const planContextSchema = z.object({
  today: isoDateSchema,
  city: z.string().max(80),
  household: z.string().max(80),
  date: isoDateSchema,
  language: z.enum(LANGUAGES),
  averagePm25: z.number().min(0),
  aqi: z.number().int().min(0),
  airLevel: z.string().max(40),
  safeToVentilate: z.boolean(),
  memberGroups: z.array(z.enum(SENSITIVITY_GROUPS)).max(12),
  mostVulnerable: z.enum(SENSITIVITY_GROUPS),
  exposureNow: z.number().min(0),
  exposureBaseline: z.number().min(0),
  exposureProtected: z.number().min(0),
  timesTarget: z.number().min(0),
  measures: z
    .array(
      z.object({
        id: z.string().max(40),
        label: z.string().max(100),
        category: z.enum(MEASURE_CATEGORIES),
        status: z.enum(MEASURE_STATUSES),
      }),
    )
    .max(30),
  routineCount: z.number().int().min(0),
  concerns: z.array(z.enum(CONCERNS)).max(3),
  risks: z.array(z.string().max(200)).max(8),
  notes: z.string().max(600),
});
export type PlanContext = z.infer<typeof planContextSchema>;

/**
 * A field the model may leave out. Models often send "" or null, or a value just
 * outside the allowed set, for something they could not fill. Treating that as
 * absent keeps the rest of a good answer instead of discarding all of it; the
 * user still reviews every pre-filled field before a plan is created.
 */
function lenient<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

/** Keep the recognised entries of a list the model filled in loosely. */
function knownValues<const T extends readonly [string, ...string[]]>(values: T, max: number) {
  return lenient(
    z.preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter((item) => (values as readonly unknown[]).includes(item)).slice(0, max)
          : value,
      z.array(z.enum(values)).max(max),
    ),
  );
}

/** Fields the model may pre-fill from a free-text description. */
const profileDraftSchema = z.object({
  household: lenient(z.string().max(80)),
  city: lenient(z.string().max(80)),
  members: lenient(
    z
      .array(
        z.object({
          label: z.string().max(40).catch(""),
          group: z.enum(SENSITIVITY_GROUPS).catch("healthy"),
        }),
      )
      .max(12),
  ),
  home: lenient(
    z.object({
      ventilation: lenient(z.enum(VENTILATION)),
      cookingFuel: lenient(z.enum(COOKING_FUELS)),
      heating: lenient(z.enum(HEATING_TYPES)),
      hasPurifier: lenient(z.boolean()),
      nearRoad: lenient(z.boolean()),
    }),
  ),
  commuteMode: lenient(z.enum(COMMUTE_MODES)),
  commuteMinutes: lenient(z.number().int().min(0).max(600)),
  commuteTime: lenient(timeSchema),
  outdoorActivity: lenient(z.enum(ACTIVITY_LEVELS)),
  outdoorTime: lenient(timeSchema),
  concerns: knownValues(CONCERNS, 3),
  notes: lenient(z.string().max(600)),
});
export type ProfileDraft = z.infer<typeof profileDraftSchema>;

const measureDraftSchema = z.object({
  label: z.string().min(1).max(100),
  /** An unknown or empty category means "none fits", which the plan treats as general. */
  category: z.enum(MEASURE_CATEGORIES).nullable().catch(null),
  why: z.string().min(1).max(300),
});

export const aiContracts = {
  interpret: {
    input: z.object({ text: z.string().trim().min(3).max(MAX_INTERPRET_TEXT) }),
    output: z.object({
      profile: profileDraftSchema,
      assumptions: z.array(z.string().max(200)).max(5),
      questions: z.array(z.string().max(200)).max(3),
      reasoning: z.string().min(1).max(400),
    }),
  },
  personalize: {
    input: z.object({ profile: profileSchema, air: airContextSchema }),
    output: z.object({
      summary: z.string().min(1).max(600),
      measures: z.array(measureDraftSchema).max(6),
      routine: z
        .array(
          z.object({
            time: timeSchema,
            title: z.string().min(1).max(160),
            why: z.string().min(1).max(300),
            category: z.enum(MEASURE_CATEGORIES).catch("monitoring"),
          }),
        )
        .max(6),
      reasoning: z.string().min(1).max(400),
    }),
  },
  swaps: {
    input: z.object({
      profile: profileSchema,
      air: airContextSchema,
      steer: z.string().trim().max(200).default(""),
      exclude: z.array(z.string().max(120)).max(30).default([]),
    }),
    output: z.object({
      swaps: z
        .array(
          z.object({
            title: z.string().min(1).max(120),
            description: z.string().min(1).max(500),
            category: z.string().min(1).max(40),
            co2eKgPerWeek: z.number().min(0).max(100_000),
            exposureReductionPerDay: z.number().min(0).max(1_000_000),
            why: z.string().min(1).max(300),
          }),
        )
        .min(1)
        .max(6),
      reasoning: z.string().min(1).max(400),
    }),
  },
  review: {
    input: z.object({ context: planContextSchema }),
    output: z.object({
      advice: z
        .array(z.object({ title: z.string().min(1).max(120), detail: z.string().min(1).max(400) }))
        .min(1)
        .max(5),
      moves: z.array(exposureMoveSchema).max(4),
      reasoning: z.string().min(1).max(400),
    }),
  },
  measure: {
    input: z.object({
      profile: profileSchema,
      air: airContextSchema,
      measureLabel: z.string().trim().min(1).max(100),
      category: z.enum(MEASURE_CATEGORIES),
    }),
    output: measureGuideSchema.extend({
      whatToLookFor: z.array(z.string().min(1).max(300)).min(1).max(8),
      reasoning: z.string().min(1).max(400),
    }),
  },
  daysheet: {
    input: z.object({ profile: profileSchema, air: airContextSchema, wakeTime: timeSchema }),
    output: z.object({
      items: z.array(daySheetItemSchema).min(1).max(14),
      reasoning: z.string().min(1).max(400),
    }),
  },
  chat: {
    input: z.object({
      context: planContextSchema,
      history: z
        .array(chatMessageSchema.pick({ role: true, text: true }))
        .max(MAX_CHAT_HISTORY)
        .default([]),
      message: z.string().trim().min(1).max(MAX_CHAT_TEXT),
    }),
    output: z.object({
      reply: z.string().min(1).max(1500),
      reasoning: z.string().min(1).max(400),
      proposals: z.array(planProposalSchema).max(3).default([]),
    }),
  },
} as const;

export type AiFeatureName = keyof typeof aiContracts;
export const AI_FEATURE_NAMES = Object.keys(aiContracts) as AiFeatureName[];

export type AiInput<F extends AiFeatureName> = z.input<(typeof aiContracts)[F]["input"]>;
export type AiParsedInput<F extends AiFeatureName> = z.output<(typeof aiContracts)[F]["input"]>;
export type AiOutput<F extends AiFeatureName> = z.output<(typeof aiContracts)[F]["output"]>;

/** Why the deterministic planner answered instead of the model. */
const fallbackReasonSchema = z.enum(["not-configured", "rate-limited", "provider-error"]);
export type FallbackReason = z.infer<typeof fallbackReasonSchema>;

export const aiEnvelopeMeta = z.object({
  /** The provider that actually answered, which drives the honest UI badge. */
  source: aiSourceSchema,
  /** True when a prompt-injection attempt in the input was neutralised. */
  sanitized: z.boolean(),
  cached: z.boolean(),
  fallbackReason: fallbackReasonSchema.optional(),
});
export type AiEnvelopeMeta = z.infer<typeof aiEnvelopeMeta>;

export interface AiEnvelope<F extends AiFeatureName> extends AiEnvelopeMeta {
  data: AiOutput<F>;
}
