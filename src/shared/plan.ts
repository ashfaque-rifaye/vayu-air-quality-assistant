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
    routine: [...plan.routine, item].sort(byTime),
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

/** Replace the one item with this id; every other item is returned as is. */
function updateById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  update: (item: T) => T,
): T[] {
  return items.map((item) => (item.id === id ? update(item) : item));
}

function byTime(a: { time: string }, b: { time: string }): number {
  return a.time.localeCompare(b.time);
}

function updateProfile(plan: Plan, patch: Partial<Profile>, today: string): Plan {
  const profile: Profile = { ...plan.profile, ...patch };
  const cityChanged = Boolean(patch.city) && patch.city !== plan.profile.city;
  return { ...plan, profile, air: cityChanged ? rebuildAir(profile, plan.air, today) : plan.air };
}

function setAirAverage(plan: Plan, amount: number, today: string): Plan {
  if (!Number.isFinite(amount) || amount < 0) return plan;
  const air = buildAirQuality({
    city: plan.profile.city,
    averagePm25: amount,
    source: "manual",
    station: plan.air.station,
    observedAt: observedAt(today),
  });
  return { ...plan, air };
}

function addMember(plan: Plan, label: string, group: Member["group"]): Plan {
  const trimmed = label.trim();
  if (!trimmed) return plan;
  const { id, seq } = nextId(plan, "member");
  const members = [...plan.profile.members, { id, label: trimmed, group }];
  return { ...plan, seq, profile: { ...plan.profile, members } };
}

function setMembers(plan: Plan, members: Member[]): Plan {
  return { ...plan, profile: { ...plan.profile, members } };
}

function setSwaps(plan: Plan, swaps: readonly Omit<Swap, "id" | "saved">[]): Plan {
  const saved = plan.swaps.filter((swap) => swap.saved);
  const fresh = swaps.map((swap, index): Swap => ({
    ...swap,
    id: `swap-x${plan.seq + index + 1}`,
    saved: false,
  }));
  return { ...plan, seq: plan.seq + swaps.length, swaps: [...saved, ...fresh] };
}

function appendChat(plan: Plan, message: Omit<ChatMessage, "id">): Plan {
  const { id, seq } = nextId(plan, "msg");
  const chat = [...plan.chat, { ...message, id }].slice(-MAX_CHAT_MESSAGES);
  return { ...plan, seq, chat };
}

function applyChatProposal(plan: Plan, messageId: string, index: number): Plan {
  const proposal = plan.chat.find((m) => m.id === messageId)?.proposals?.[index];
  if (!proposal) return plan;
  return withoutProposal(applyProposal(plan, proposal), messageId, index);
}

/** Layer the AI's tailoring over the plan, skipping anything it already covers. */
function applyPersonalization(plan: Plan, payload: PersonalizationPayload): Plan {
  const withMeasures = payload.measures.reduce(
    (next, measure) =>
      duplicatesExisting(next, measure) ? next : addMeasure(next, { ...measure, source: "ai" }),
    plan,
  );
  const withRoutine = payload.routine.reduce(
    (next, item) => addRoutineItem(next, { ...item, source: "ai" }),
    withMeasures,
  );
  const { summary, reasoning, source } = payload;
  return { ...withRoutine, personalization: { summary, reasoning, source } };
}

type ActionOf<T extends PlanAction["type"]> = Extract<PlanAction, { type: T }>;
type Handlers = {
  [T in PlanAction["type"]]: (plan: Plan, action: ActionOf<T>, today: string) => Plan;
};

/** One small, pure handler per action. Adding an action without a handler fails to compile. */
const HANDLERS: Handlers = {
  updateProfile: (plan, { patch }, today) => updateProfile(plan, patch, today),
  setAirAverage: (plan, { amount }, today) => setAirAverage(plan, amount, today),
  resetAir: (plan, _action, today) => ({
    ...plan,
    air: buildAirQuality({
      city: plan.profile.city,
      source: "model",
      observedAt: observedAt(today),
    }),
  }),
  regenerateRoutine: (plan) => {
    const kept = plan.routine.filter((item) => item.source === "you");
    return { ...plan, routine: [...buildRoutine(plan.profile, plan.air), ...kept].sort(byTime) };
  },
  addMember: (plan, { label, group }) => addMember(plan, label, group),
  removeMember: (plan, { id }) =>
    plan.profile.members.length <= 1
      ? plan
      : setMembers(
          plan,
          plan.profile.members.filter((m) => m.id !== id),
        ),
  updateMember: (plan, { id, patch }) =>
    setMembers(
      plan,
      updateById(plan.profile.members, id, (m) => ({ ...m, ...patch })),
    ),
  setMeasureStatus: (plan, { id, status }) => ({
    ...plan,
    measures: updateById(plan.measures, id, (m) => ({ ...m, status })),
  }),
  addMeasure: (plan, action) => addMeasure(plan, action),
  removeMeasure: (plan, { id }) => ({
    ...plan,
    measures: plan.measures.filter((m) => m.id !== id),
  }),
  updateMeasure: (plan, { id, patch }) => ({
    ...plan,
    measures: updateById(plan.measures, id, (m) => ({ ...m, ...patch })),
  }),
  setMeasureGuide: (plan, { id, guide }) => ({
    ...plan,
    measures: updateById(plan.measures, id, (m) => ({ ...m, guide })),
  }),
  toggleMeasureCheck: (plan, { measureId, checkId }) => ({
    ...plan,
    measures: updateById(plan.measures, measureId, (m) => ({
      ...m,
      checks: updateById(m.checks, checkId, (c) => ({ ...c, done: !c.done })),
    })),
  }),
  setReview: (plan, { review }) => ({ ...plan, review }),
  setSwaps: (plan, { swaps }) => setSwaps(plan, swaps),
  toggleSwapSaved: (plan, { id }) => ({
    ...plan,
    swaps: updateById(plan.swaps, id, (swap) => ({ ...swap, saved: !swap.saved })),
  }),
  setDaySheet: (plan, { items }) => ({ ...plan, daySheet: [...items] }),
  addRoutineItem: (plan, action) => addRoutineItem(plan, action),
  removeRoutineItem: (plan, { id }) => ({
    ...plan,
    routine: plan.routine.filter((item) => item.id !== id),
  }),
  appendChat: (plan, { message }) => appendChat(plan, message),
  applyProposal: (plan, { messageId, index }) => applyChatProposal(plan, messageId, index),
  dismissProposal: (plan, { messageId, index }) => withoutProposal(plan, messageId, index),
  applyPersonalization: (plan, { payload }) => applyPersonalization(plan, payload),
};

/**
 * The single place a plan changes. Invalid actions return the plan unchanged, so
 * a stale or hallucinated id is a no-op rather than a corrupted plan.
 */
export function planReducer(plan: Plan, action: PlanAction, today: string): Plan {
  const handle = HANDLERS[action.type] as (plan: Plan, action: PlanAction, today: string) => Plan;
  return handle(plan, action, today);
}
