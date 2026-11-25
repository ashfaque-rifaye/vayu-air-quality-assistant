/**
 * The intake form's state and the pure rules around it: an empty form, turning it
 * into a validated profile, and merging an AI draft into it. Kept apart from the
 * JSX so each rule is small, named and testable on its own.
 */
import type { ProfileDraft } from "../../../shared/contracts";
import { todayIso } from "../../../shared/dates";
import {
  MAX_CONCERNS,
  profileSchema,
  type ActivityLevel,
  type CommuteMode,
  type Concern,
  type CookingFuel,
  type HeatingType,
  type Language,
  type Profile,
  type SensitivityGroup,
  type Ventilation,
} from "../../../shared/schemas";

export interface MemberRow {
  id: string;
  label: string;
  group: SensitivityGroup;
}

/** The home, with number inputs kept as the strings the person typed. */
export interface HomeState {
  ventilation: Ventilation;
  cookingFuel: CookingFuel;
  heating: HeatingType;
  roomSqm: string;
  nearRoad: boolean;
  hasPurifier: boolean;
  purifierCadr: string;
}

export interface FormState {
  household: string;
  city: string;
  date: string;
  members: MemberRow[];
  home: HomeState;
  commuteMode: CommuteMode;
  commuteMinutes: string;
  commuteTime: string;
  outdoorActivity: ActivityLevel;
  outdoorTime: string;
  concerns: Concern[];
  notes: string;
  language: Language;
}

export type FieldKey = "household" | "city" | "date" | "members";
export type FieldErrors = Partial<Record<FieldKey, string>>;

/** The order errors are listed in, matching the order of the fields on screen. */
export const ERROR_ORDER: readonly FieldKey[] = ["household", "city", "date", "members"];

/** Assumed one-way commute when someone names a mode but not a duration. */
const DEFAULT_COMMUTE_MINUTES = "30";

export function newMember(label = "", group: SensitivityGroup = "healthy"): MemberRow {
  return { id: crypto.randomUUID().slice(0, 12), label, group };
}

export function emptyForm(): FormState {
  return {
    household: "",
    city: "",
    date: todayIso(),
    members: [newMember("Me", "healthy")],
    home: {
      ventilation: "average",
      cookingFuel: "lpg",
      heating: "none",
      roomSqm: "20",
      nearRoad: false,
      hasPurifier: false,
      purifierCadr: "",
    },
    commuteMode: "none",
    commuteMinutes: "0",
    commuteTime: "09:00",
    outdoorActivity: "none",
    outdoorTime: "07:00",
    concerns: [],
    notes: "",
    language: "en",
  };
}

/** A blank number input means "not given", not zero. */
function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

/** The form in the shape the profile schema expects. */
function toProfileInput(form: FormState) {
  return {
    ...form,
    members: form.members.map(({ id, label, group }) => ({ id, label, group })),
    home: {
      ...form.home,
      roomSqm: optionalNumber(form.home.roomSqm),
      purifierCadr: optionalNumber(form.home.purifierCadr) ?? null,
    },
    commuteMinutes: optionalNumber(form.commuteMinutes) ?? 0,
  };
}

function isFieldKey(key: PropertyKey | undefined): key is FieldKey {
  return ERROR_ORDER.includes(key as FieldKey);
}

/** The first message for each field the person can fix; a general one if none map. */
function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (isFieldKey(key)) errors[key] ??= issue.message;
  }
  return Object.keys(errors).length > 0 ? errors : { household: "Please check the details above." };
}

export type Validation =
  { profile: Profile; errors?: undefined } | { profile?: undefined; errors: FieldErrors };

export function validateForm(form: FormState): Validation {
  const result = profileSchema.safeParse(toProfileInput(form));
  return result.success ? { profile: result.data } : { errors: fieldErrors(result.error.issues) };
}

/**
 * A commute with no duration would silently drop out of the exposure model, so a
 * chosen mode gets a typical duration that stays visible and editable.
 */
export function withCommuteDefault(form: FormState): FormState {
  const minutes = Number(form.commuteMinutes);
  return form.commuteMode !== "none" && !(minutes > 0)
    ? { ...form, commuteMinutes: DEFAULT_COMMUTE_MINUTES }
    : form;
}

/** Only the entries that carry a value: blank text and missing fields leave the form alone. */
function filledIn<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ""),
  ) as Partial<T>;
}

/** Merge what the AI read from a description into the form, keeping everything it left out. */
export function applyDraft(form: FormState, draft: ProfileDraft): FormState {
  const { members, home, commuteMinutes, concerns } = draft;
  return withCommuteDefault({
    ...form,
    ...filledIn({
      household: draft.household,
      city: draft.city,
      commuteMode: draft.commuteMode,
      commuteTime: draft.commuteTime,
      outdoorActivity: draft.outdoorActivity,
      outdoorTime: draft.outdoorTime,
      notes: draft.notes,
      commuteMinutes: commuteMinutes === undefined ? undefined : String(commuteMinutes),
      concerns: concerns?.slice(0, MAX_CONCERNS),
      members: members?.length ? members.map((m) => newMember(m.label, m.group)) : undefined,
    }),
    home: { ...form.home, ...filledIn({ ...home }) },
  });
}
