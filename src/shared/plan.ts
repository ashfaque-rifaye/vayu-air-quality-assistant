/**
 * Plan construction and the reducer behind every change to a plan.
 *
 * All edits, whether typed by the user or proposed by the AI and approved, flow
 * through `planReducer`. It is pure, so the rules that protect a plan live in one
 * tested place and an AI suggestion gets no special path around them: a proposal
 * to adopt a measure that does not exist, or to add an empty routine item, is a
 * no-op rather than a corrupted plan.
 */
import { buildAirQuality } from "./aqi.js";
import { buildRoutine } from "./routine.js";
import { inferCategory, MEASURE_TEMPLATES, measureChecklist, seedMeasures } from "./knowledge.js";
import {
  PLAN_VERSION,
  type AirQuality,
  type ChatMessage,
  type ExposureReview,
  type Measure,
  type MeasureCategory,
  type MeasureGuide,
  type MeasureStatus,
  type Member,
  type Personalization,
  type Plan,
  type PlanProposal,
  type Profile,
  type RoutineItem,
  type Swap,
  type DaySheetItem,
} from "./schemas.js";

const MAX_CHAT_MESSAGES = 200;
const DEFAULT_MEASURE_CATEGORY: MeasureCategory = "monitoring";

function observedAt(today: string): string {
  return `${today}T00:00:00.000Z`;
}

export function createPlan(
  profile: Profile,
  options: { id: string; today: string; now: string },
): Plan {
  const air = buildAirQuality({
    city: profile.city,
    source: "model",
    observedAt: observedAt(options.today),
  });
  return {
    version: PLAN_VERSION,
    id: options.id,
    createdAt: options.now,
    updatedAt: options.now,
    seq: 0,
    profile,
    air,
    measures: seedMeasures(profile),
    routine: buildRoutine(profile, air),
    swaps: [],
    daySheet: [],
    chat: [],
    personalization: null,
    review: null,
  };
}

interface PersonalizationPayload {
  summary: string;
  reasoning: string;
  source: Personalization["source"];
  measures: readonly { label: string; category: MeasureCategory | null; why: string }[];
  routine: readonly { time: string; title: string; why: string; category: MeasureCategory }[];
}

/**
 * Would this suggestion repeat something the plan already covers? The exposure
 * model credits each category once, so a second "masks" measure would add a card
 * without adding protection. Uncategorised suggestions are kept unless the label
 * is already there.
 */
function duplicatesExisting(
  plan: Plan,
  suggestion: { label: string; category: MeasureCategory | null },
): boolean {
  const label = suggestion.label.trim().toLowerCase();
  return plan.measures.some(
    (m) =>
      m.status !== "dismissed" &&
      (m.label.trim().toLowerCase() === label ||
        (suggestion.category !== null && m.category === suggestion.category)),
  );
}

export type PlanAction =
  | { type: "updateProfile"; patch: Partial<Profile> }
  | { type: "setAirAverage"; amount: number }
  | { type: "resetAir" }
  | { type: "regenerateRoutine" }
  | { type: "addMember"; label: string; group: Member["group"] }
  | { type: "removeMember"; id: string }
  | { type: "updateMember"; id: string; patch: Partial<Pick<Member, "label" | "group">> }
  | { type: "setMeasureStatus"; id: string; status: MeasureStatus }
  | {
      type: "addMeasure";
      label: string;
      category?: MeasureCategory | null;
      why?: string;
      source?: "ai" | "you";
    }
  | { type: "removeMeasure"; id: string }
  | { type: "updateMeasure"; id: string; patch: Partial<Pick<Measure, "cost" | "notes">> }
  | { type: "setMeasureGuide"; id: string; guide: MeasureGuide }
  | { type: "toggleMeasureCheck"; measureId: string; checkId: string }
  | { type: "setReview"; review: ExposureReview }
  | { type: "setSwaps"; swaps: readonly Omit<Swap, "id" | "saved">[] }
  | { type: "toggleSwapSaved"; id: string }
  | { type: "setDaySheet"; items: readonly DaySheetItem[] }
  | {
      type: "addRoutineItem";
      time: string;
      title: string;
      why?: string;
      category?: MeasureCategory;
      source?: "ai" | "you";
    }
  | { type: "removeRoutineItem"; id: string }
  | { type: "appendChat"; message: Omit<ChatMessage, "id"> }
  | { type: "applyProposal"; messageId: string; index: number }
  | { type: "dismissProposal"; messageId: string; index: number }
  | { type: "applyPersonalization"; payload: PersonalizationPayload };

function nextId(plan: Plan, prefix: string): { id: string; seq: number } {
  const seq = plan.seq + 1;
  return { id: `${prefix}-x${seq}`, seq };
}

function rebuildAir(profile: Profile, air: AirQuality, today: string): AirQuality {
  if (air.source !== "model") return air;
  return buildAirQuality({ city: profile.city, source: "model", observedAt: observedAt(today) });
}

function addMeasure(
  plan: Plan,
  action: { label: string; category?: MeasureCategory | null; why?: string; source?: "ai" | "you" },
): Plan {
  const label = action.label.trim();
  if (!label) return plan;
  const category = action.category ?? DEFAULT_MEASURE_CATEGORY;
  const template = MEASURE_TEMPLATES[category];
  const { id, seq } = nextId(plan, "measure");
  return {
    ...plan,
    seq,
    measures: [
      ...plan.measures,
      {
        id,
        category,
        label,
        status: "suggested",
        cost: template.typicalCost,
        effortDays: template.effortDays,
        notes: "",
        source: action.source ?? "you",
        ...(action.why ? { why: action.why } : {}),
        checks: measureChecklist(category).map((checkLabel, index) => ({
          id: `check-${index + 1}`,
          label: checkLabel,
          done: false,
        })),
      },
    ],
  };
}

function addRoutineItem(
  plan: Plan,
  action: {
    time: string;
    title: string;
    why?: string;
    category?: MeasureCategory;
    source?: "ai" | "you";
  },
): Plan {
  const title = action.title.trim();
  if (!title) return plan;
  const { id, seq } = nextId(plan, "routine");
  const item: RoutineItem = {
    id,
    time: action.time,
    title,
    // "monitoring" is the catch-all, so a more specific reading of the title wins.
    category:
      action.category && action.category !== DEFAULT_MEASURE_CATEGORY
        ? action.category
        : inferCategory(title),
    source: action.source ?? "you",
    ...(action.why ? { why: action.why } : {}),
  };
  return {
    ...plan,
    seq,
    routine: [...plan.routine, item].sort((a, b) => a.time.localeCompare(b.time)),
  };
}

function adoptMeasure(plan: Plan, measureId: string): Plan {
  const measure = plan.measures.find((m) => m.id === measureId);
  if (!measure || measure.status === "done") return plan;
  return {
    ...plan,
    measures: plan.measures.map((m) => (m.id === measureId ? { ...m, status: "done" } : m)),
  };
}

function withoutProposal(plan: Plan, messageId: string, index: number): Plan {
  return {
    ...plan,
    chat: plan.chat.map((message) =>
      message.id === messageId
        ? { ...message, proposals: message.proposals?.filter((_, i) => i !== index) ?? [] }
        : message,
    ),
  };
}

function applyProposal(plan: Plan, proposal: PlanProposal): Plan {
  switch (proposal.type) {
    case "addMeasure":
      return addMeasure(plan, { ...proposal, source: "ai" });
    case "addRoutineItem":
      return addRoutineItem(plan, { ...proposal, source: "ai" });
    case "adoptMeasure":
      return adoptMeasure(plan, proposal.measureId);
  }
}

/**
 * The single place a plan changes. Invalid actions return the plan unchanged, so
 * a stale or hallucinated id is a no-op rather than a corrupted plan.
 */
export function planReducer(plan: Plan, action: PlanAction, today: string): Plan {
  switch (action.type) {
    case "updateProfile": {
      const profile: Profile = { ...plan.profile, ...action.patch };
      const air =
        action.patch.city && action.patch.city !== plan.profile.city
          ? rebuildAir(profile, plan.air, today)
          : plan.air;
      return { ...plan, profile, air };
    }
    case "setAirAverage": {
      if (!Number.isFinite(action.amount) || action.amount < 0) return plan;
      return {
        ...plan,
        air: buildAirQuality({
          city: plan.profile.city,
          averagePm25: action.amount,
          source: "manual",
          station: plan.air.station,
          observedAt: observedAt(today),
        }),
      };
    }
    case "resetAir":
      return {
        ...plan,
        air: buildAirQuality({
          city: plan.profile.city,
          source: "model",
          observedAt: observedAt(today),
        }),
      };
    case "regenerateRoutine": {
      const kept = plan.routine.filter((item) => item.source === "you");
      const auto = buildRoutine(plan.profile, plan.air);
      return { ...plan, routine: [...auto, ...kept].sort((a, b) => a.time.localeCompare(b.time)) };
    }
    case "addMember": {
      const label = action.label.trim();
      if (!label) return plan;
      const { id, seq } = nextId(plan, "member");
      return {
        ...plan,
        seq,
        profile: {
          ...plan.profile,
          members: [...plan.profile.members, { id, label, group: action.group }],
        },
      };
    }
    case "removeMember": {
      if (plan.profile.members.length <= 1) return plan;
      return {
        ...plan,
        profile: {
          ...plan.profile,
          members: plan.profile.members.filter((m) => m.id !== action.id),
        },
      };
    }
    case "updateMember":
      return {
        ...plan,
        profile: {
          ...plan.profile,
          members: plan.profile.members.map((m) =>
            m.id === action.id ? { ...m, ...action.patch } : m,
          ),
        },
      };
    case "setMeasureStatus":
      return {
        ...plan,
        measures: plan.measures.map((m) =>
          m.id === action.id ? { ...m, status: action.status } : m,
        ),
      };
    case "addMeasure":
      return addMeasure(plan, action);
    case "removeMeasure":
      return { ...plan, measures: plan.measures.filter((m) => m.id !== action.id) };
    case "updateMeasure":
      return {
        ...plan,
        measures: plan.measures.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      };
    case "setMeasureGuide":
      return {
        ...plan,
        measures: plan.measures.map((m) =>
          m.id === action.id ? { ...m, guide: action.guide } : m,
        ),
      };
    case "toggleMeasureCheck":
      return {
        ...plan,
        measures: plan.measures.map((m) =>
          m.id === action.measureId
            ? {
                ...m,
                checks: m.checks.map((c) =>
                  c.id === action.checkId ? { ...c, done: !c.done } : c,
                ),
              }
            : m,
        ),
      };
    case "setReview":
      return { ...plan, review: action.review };
    case "setSwaps": {
      const saved = plan.swaps.filter((swap) => swap.saved);
      let seq = plan.seq;
      const fresh = action.swaps.map((swap): Swap => {
        seq += 1;
        return { ...swap, id: `swap-x${seq}`, saved: false };
      });
      return { ...plan, seq, swaps: [...saved, ...fresh] };
    }
    case "toggleSwapSaved":
      return {
        ...plan,
        swaps: plan.swaps.map((swap) =>
          swap.id === action.id ? { ...swap, saved: !swap.saved } : swap,
        ),
      };
    case "setDaySheet":
      return { ...plan, daySheet: [...action.items] };
    case "addRoutineItem":
      return addRoutineItem(plan, action);
    case "removeRoutineItem":
      return { ...plan, routine: plan.routine.filter((item) => item.id !== action.id) };
    case "appendChat": {
      const { id, seq } = nextId(plan, "msg");
      const chat = [...plan.chat, { ...action.message, id }];
      return { ...plan, seq, chat: chat.slice(-MAX_CHAT_MESSAGES) };
    }
    case "applyProposal": {
      const message = plan.chat.find((m) => m.id === action.messageId);
      const proposal = message?.proposals?.[action.index];
      if (!proposal) return plan;
      return withoutProposal(applyProposal(plan, proposal), action.messageId, action.index);
    }
    case "dismissProposal":
      return withoutProposal(plan, action.messageId, action.index);
    case "applyPersonalization": {
      const { payload } = action;
      let next = plan;
      for (const measure of payload.measures) {
        if (duplicatesExisting(next, measure)) continue;
        next = addMeasure(next, {
          label: measure.label,
          category: measure.category,
          why: measure.why,
          source: "ai",
        });
      }
      for (const item of payload.routine) {
        next = addRoutineItem(next, { ...item, source: "ai" });
      }
      return {
        ...next,
        personalization: {
          summary: payload.summary,
          reasoning: payload.reasoning,
          source: payload.source,
        },
      };
    }
  }
}
