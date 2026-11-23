import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Sparkles, Trash2, Wind } from "lucide-react";
import { MAX_INTERPRET_TEXT, type ProfileDraft } from "../../shared/contracts";
import { todayIso } from "../../shared/dates";
import { LANGUAGE_NAMES } from "../../shared/languages";
import { createPlan } from "../../shared/plan";
import {
  ACTIVITY_LEVELS,
  COMMUTE_MODES,
  CONCERNS,
  COOKING_FUELS,
  HEATING_TYPES,
  LANGUAGES,
  MAX_CONCERNS,
  profileSchema,
  SENSITIVITY_GROUPS,
  VENTILATION,
  type ActivityLevel,
  type CommuteMode,
  type Concern,
  type CookingFuel,
  type HeatingType,
  type Language,
  type Profile,
  type SensitivityGroup,
  type Ventilation,
} from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import type { PlanStore } from "../lib/plan-store";
import { navigate, planHref } from "../lib/route";
import { useAi } from "../lib/use-ai";
import { AiBadge, describedBy, ErrorNote, Field, Loading, Why } from "./ui";

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

const EXAMPLES: readonly { label: string; text: string }[] = [
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

interface MemberRow {
  id: string;
  label: string;
  group: SensitivityGroup;
}

interface HomeState {
  ventilation: Ventilation;
  cookingFuel: CookingFuel;
  heating: HeatingType;
  roomSqm: string;
  nearRoad: boolean;
  hasPurifier: boolean;
  purifierCadr: string;
}

interface FormState {
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

function newMember(label = "", group: SensitivityGroup = "healthy"): MemberRow {
  return { id: crypto.randomUUID().slice(0, 12), label, group };
}

function emptyForm(): FormState {
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

type FieldErrors = Partial<Record<"household" | "city" | "date" | "members", string>>;

function toNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

export function validateForm(
  form: FormState,
): { profile: Profile; errors?: undefined } | { profile?: undefined; errors: FieldErrors } {
  const raw = {
    household: form.household,
    city: form.city,
    date: form.date,
    members: form.members.map((m) => ({ id: m.id, label: m.label, group: m.group })),
    home: {
      ventilation: form.home.ventilation,
      cookingFuel: form.home.cookingFuel,
      heating: form.home.heating,
      roomSqm: toNumber(form.home.roomSqm),
      nearRoad: form.home.nearRoad,
      hasPurifier: form.home.hasPurifier,
      purifierCadr: form.home.purifierCadr.trim() === "" ? null : toNumber(form.home.purifierCadr),
    },
    commuteMode: form.commuteMode,
    commuteMinutes: toNumber(form.commuteMinutes) ?? 0,
    commuteTime: form.commuteTime,
    outdoorActivity: form.outdoorActivity,
    outdoorTime: form.outdoorTime,
    concerns: form.concerns,
    notes: form.notes,
    language: form.language,
  };
  const result = profileSchema.safeParse(raw);
  if (result.success) return { profile: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (key === "household" || key === "city" || key === "date" || key === "members") {
      errors[key] ??= issue.message;
    }
  }
  if (Object.keys(errors).length === 0) errors.household = "Please check the details above.";
  return { errors };
}

/** Assumed one-way commute when someone names a mode but not a duration. */
const DEFAULT_COMMUTE_MINUTES = "30";

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

function applyDraft(form: FormState, draft: ProfileDraft): FormState {
  return withCommuteDefault({
    ...form,
    ...(draft.household ? { household: draft.household } : {}),
    ...(draft.city ? { city: draft.city } : {}),
    ...(draft.members && draft.members.length > 0
      ? { members: draft.members.map((m) => newMember(m.label, m.group)) }
      : {}),
    home: {
      ...form.home,
      ...(draft.home?.ventilation ? { ventilation: draft.home.ventilation } : {}),
      ...(draft.home?.cookingFuel ? { cookingFuel: draft.home.cookingFuel } : {}),
      ...(draft.home?.heating ? { heating: draft.home.heating } : {}),
      ...(draft.home?.hasPurifier !== undefined ? { hasPurifier: draft.home.hasPurifier } : {}),
      ...(draft.home?.nearRoad !== undefined ? { nearRoad: draft.home.nearRoad } : {}),
    },
    ...(draft.commuteMode ? { commuteMode: draft.commuteMode } : {}),
    ...(draft.commuteMinutes !== undefined ? { commuteMinutes: String(draft.commuteMinutes) } : {}),
    ...(draft.commuteTime ? { commuteTime: draft.commuteTime } : {}),
    ...(draft.outdoorActivity ? { outdoorActivity: draft.outdoorActivity } : {}),
    ...(draft.outdoorTime ? { outdoorTime: draft.outdoorTime } : {}),
    ...(draft.concerns ? { concerns: draft.concerns.slice(0, MAX_CONCERNS) } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
  });
}

const ERROR_ORDER: readonly (keyof FieldErrors)[] = ["household", "city", "date", "members"];

export function IntakeFlow({ store }: { store: PlanStore }) {
  const announce = useAnnounce();
  const [description, setDescription] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failedSubmits, setFailedSubmits] = useState(0);
  const errorSummary = useRef<HTMLDivElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const { state: draftState, run: runDraft } = useAi("interpret");
  const today = todayIso();

  useEffect(() => {
    if (failedSubmits > 0) errorSummary.current?.focus();
  }, [failedSubmits]);

  function setHome<K extends keyof HomeState>(key: K, value: HomeState[K]): void {
    setForm((current) => ({ ...current, home: { ...current.home, [key]: value } }));
  }

  async function draftFromDescription(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (description.trim().length < 3) return;
    const envelope = await runDraft({ text: description });
    if (envelope) {
      setForm((current) => applyDraft(current, envelope.data.profile));
      setErrors({});
      announce("Details filled in. Check them below, then create your plan.");
      formHeading.current?.focus();
    }
  }

  function createFromForm(event: FormEvent): void {
    event.preventDefault();
    const result = validateForm(form);
    if (result.errors) {
      setErrors(result.errors);
      setFailedSubmits((count) => count + 1);
      return;
    }
    const id = crypto.randomUUID();
    store.add(createPlan(result.profile, { id, today, now: new Date().toISOString() }));
    navigate(planHref(id));
  }

  const errorEntries = ERROR_ORDER.flatMap((key) => {
    const message = errors[key];
    return message ? [{ key, message }] : [];
  });
  const concernsFull = form.concerns.length >= MAX_CONCERNS;

  return (
    <div className="intake">
      <section className="card card-raised intake-describe" aria-labelledby="describe-title">
        <p className="step-label">Step 1 · Optional, but it saves typing</p>
        <h2 id="describe-title">
          <Sparkles aria-hidden="true" size={22} /> Describe your home and household in your own
          words
        </h2>
        <form onSubmit={(event) => void draftFromDescription(event)}>
          <Field
            id="household-description"
            label="Tell Vayu about your situation"
            hint="Mention your city, who lives with you (and any children, older adults or health conditions), how you cook and heat, and your daily routine."
          >
            <textarea
              id="household-description"
              rows={4}
              maxLength={MAX_INTERPRET_TEXT}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-describedby="household-description-hint"
            />
          </Field>
          <div className="chip-row" role="group" aria-label="Example descriptions">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                className="chip"
                onClick={() => setDescription(example.text)}
              >
                Try: {example.label}
              </button>
            ))}
          </div>
          <button
            type="submit"
            className="button button-primary"
            disabled={draftState.status === "loading" || description.trim().length < 3}
          >
            <Sparkles aria-hidden="true" size={16} />
            Fill in the details with AI
          </button>
        </form>

        <div aria-live="polite">
          {draftState.status === "loading" ? (
            <Loading>Vayu is reading your description…</Loading>
          ) : null}
          {draftState.status === "error" ? <ErrorNote message={draftState.message} /> : null}
          {draftState.status === "success" ? (
            <div className="ai-result" data-testid="interpret-result">
              <AiBadge meta={draftState.envelope} />
              <Why text={draftState.envelope.data.reasoning} />
              {draftState.envelope.data.assumptions.length > 0 ? (
                <>
                  <h3>What Vayu assumed</h3>
                  <ul>
                    {draftState.envelope.data.assumptions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {draftState.envelope.data.questions.length > 0 ? (
                <>
                  <h3>Still needed from you</h3>
                  <ul>
                    {draftState.envelope.data.questions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="details-title">
        <p className="step-label">Step 2 · Check the details</p>
        <h2 id="details-title" ref={formHeading} tabIndex={-1}>
          Household details
        </h2>
        <form noValidate onSubmit={createFromForm}>
          {errorEntries.length > 0 ? (
            <div className="callout callout-danger" role="alert" ref={errorSummary} tabIndex={-1}>
              <p>
                <strong>
                  Please fix {errorEntries.length === 1 ? "this" : "these"} to continue:
                </strong>
              </p>
              <ul>
                {errorEntries.map(({ key, message }) => (
                  <li key={key}>
                    <a
                      href={`#profile-${key}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(`profile-${key}`)?.focus();
                      }}
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="form-grid">
            <Field id="profile-household" label="Household name" error={errors.household}>
              <input
                id="profile-household"
                type="text"
                maxLength={80}
                placeholder="The Khan family"
                value={form.household}
                onChange={(event) => setForm((c) => ({ ...c, household: event.target.value }))}
                {...describedBy("profile-household", { error: errors.household })}
              />
            </Field>
            <Field
              id="profile-city"
              label="City"
              error={errors.city}
              hint="Vayu knows the winter-smog profile of many cities."
            >
              <input
                id="profile-city"
                type="text"
                maxLength={80}
                placeholder="Delhi"
                value={form.city}
                onChange={(event) => setForm((c) => ({ ...c, city: event.target.value }))}
                {...describedBy("profile-city", { hint: true, error: errors.city })}
              />
            </Field>
            <Field id="profile-date" label="Day to plan for" error={errors.date}>
              <input
                id="profile-date"
                type="date"
                value={form.date}
                onChange={(event) => setForm((c) => ({ ...c, date: event.target.value }))}
                {...describedBy("profile-date", { error: errors.date })}
              />
            </Field>
            <Field
              id="profile-language"
              label="Language for AI advice"
              hint="Vayu's menus stay in English."
            >
              <select
                id="profile-language"
                value={form.language}
                onChange={(event) =>
                  setForm((c) => ({ ...c, language: event.target.value as Language }))
                }
                aria-describedby="profile-language-hint"
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {LANGUAGE_NAMES[language]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset className="subform" id="profile-members">
            <legend>Who lives here?</legend>
            <p className="field-hint">
              The most sensitive person sets how carefully Vayu plans. {errors.members}
            </p>
            <ul className="member-list">
              {form.members.map((member, index) => (
                <li key={member.id} className="member-row">
                  <Field id={`member-label-${member.id}`} label={`Person ${index + 1}`}>
                    <input
                      id={`member-label-${member.id}`}
                      type="text"
                      maxLength={40}
                      value={member.label}
                      onChange={(event) =>
                        setForm((c) => ({
                          ...c,
                          members: c.members.map((m) =>
                            m.id === member.id ? { ...m, label: event.target.value } : m,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <Field id={`member-group-${member.id}`} label="Sensitivity">
                    <select
                      id={`member-group-${member.id}`}
                      value={member.group}
                      onChange={(event) =>
                        setForm((c) => ({
                          ...c,
                          members: c.members.map((m) =>
                            m.id === member.id
                              ? { ...m, group: event.target.value as SensitivityGroup }
                              : m,
                          ),
                        }))
                      }
                    >
                      {SENSITIVITY_GROUPS.map((group) => (
                        <option key={group} value={group}>
                          {SENSITIVITY_LABELS[group]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {form.members.length > 1 ? (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${member.label || `person ${index + 1}`}`}
                      onClick={() =>
                        setForm((c) => ({
                          ...c,
                          members: c.members.filter((m) => m.id !== member.id),
                        }))
                      }
                    >
                      <Trash2 aria-hidden="true" size={18} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="button"
              onClick={() => setForm((c) => ({ ...c, members: [...c.members, newMember()] }))}
            >
              <Plus aria-hidden="true" size={16} /> Add a person
            </button>
          </fieldset>

          <fieldset className="subform">
            <legend>Your home</legend>
            <div className="form-grid">
              <Field id="home-ventilation" label="How airtight is it?">
                <select
                  id="home-ventilation"
                  value={form.home.ventilation}
                  onChange={(event) => setHome("ventilation", event.target.value as Ventilation)}
                >
                  {VENTILATION.map((v) => (
                    <option key={v} value={v}>
                      {VENTILATION_LABELS[v]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="home-cooking" label="Cooking fuel">
                <select
                  id="home-cooking"
                  value={form.home.cookingFuel}
                  onChange={(event) => setHome("cookingFuel", event.target.value as CookingFuel)}
                >
                  {COOKING_FUELS.map((f) => (
                    <option key={f} value={f}>
                      {FUEL_LABELS[f]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="home-heating" label="Winter heating">
                <select
                  id="home-heating"
                  value={form.home.heating}
                  onChange={(event) => setHome("heating", event.target.value as HeatingType)}
                >
                  {HEATING_TYPES.map((h) => (
                    <option key={h} value={h}>
                      {HEATING_LABELS[h]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="home-room" label="Main room size (m²)">
                <input
                  id="home-room"
                  type="number"
                  inputMode="numeric"
                  min={4}
                  value={form.home.roomSqm}
                  onChange={(event) => setHome("roomSqm", event.target.value)}
                />
              </Field>
            </div>
            <div className="checkbox-grid">
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={form.home.nearRoad}
                  onChange={(event) => setHome("nearRoad", event.target.checked)}
                />
                We live next to a busy road
              </label>
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={form.home.hasPurifier}
                  onChange={(event) => setHome("hasPurifier", event.target.checked)}
                />
                We already have an air purifier
              </label>
            </div>
            {form.home.hasPurifier ? (
              <Field
                id="home-cadr"
                label="Purifier CADR (m³/h, optional)"
                hint="On the box or specs. Leave blank if unsure."
              >
                <input
                  id="home-cadr"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.home.purifierCadr}
                  onChange={(event) => setHome("purifierCadr", event.target.value)}
                  aria-describedby="home-cadr-hint"
                />
              </Field>
            ) : null}
          </fieldset>

          <fieldset className="subform">
            <legend>Daily routine</legend>
            <div className="form-grid">
              <Field id="commute-mode" label="How do you commute?">
                <select
                  id="commute-mode"
                  value={form.commuteMode}
                  onChange={(event) =>
                    setForm((c) =>
                      withCommuteDefault({ ...c, commuteMode: event.target.value as CommuteMode }),
                    )
                  }
                >
                  {COMMUTE_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {COMMUTE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </Field>
              {form.commuteMode !== "none" ? (
                <>
                  <Field id="commute-minutes" label="Minutes each way">
                    <input
                      id="commute-minutes"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.commuteMinutes}
                      onChange={(event) =>
                        setForm((c) => ({ ...c, commuteMinutes: event.target.value }))
                      }
                    />
                  </Field>
                  <Field id="commute-time" label="Leaves home at">
                    <input
                      id="commute-time"
                      type="time"
                      value={form.commuteTime}
                      onChange={(event) =>
                        setForm((c) => ({ ...c, commuteTime: event.target.value }))
                      }
                    />
                  </Field>
                </>
              ) : null}
              <Field id="outdoor-activity" label="Outdoor exercise">
                <select
                  id="outdoor-activity"
                  value={form.outdoorActivity}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, outdoorActivity: event.target.value as ActivityLevel }))
                  }
                >
                  {ACTIVITY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {ACTIVITY_LABELS[level]}
                    </option>
                  ))}
                </select>
              </Field>
              {form.outdoorActivity !== "none" ? (
                <Field id="outdoor-time" label="Usually at">
                  <input
                    id="outdoor-time"
                    type="time"
                    value={form.outdoorTime}
                    onChange={(event) =>
                      setForm((c) => ({ ...c, outdoorTime: event.target.value }))
                    }
                  />
                </Field>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="priority-picker">
            <legend>What matters most? Choose up to {MAX_CONCERNS}.</legend>
            <p className="field-hint">
              Vayu weights its advice and your protection score toward these.
            </p>
            <div className="checkbox-grid">
              {CONCERNS.map((concern) => {
                const checked = form.concerns.includes(concern);
                return (
                  <label key={concern} className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && concernsFull}
                      onChange={() =>
                        setForm((c) => ({
                          ...c,
                          concerns: checked
                            ? c.concerns.filter((item) => item !== concern)
                            : [...c.concerns, concern],
                        }))
                      }
                    />
                    {CONCERN_LABELS[concern]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Field
            id="profile-notes"
            label="Anything else Vayu should know? (optional)"
            hint="Local smog sources, a medical detail, a routine, things to avoid."
          >
            <textarea
              id="profile-notes"
              rows={3}
              maxLength={600}
              value={form.notes}
              onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
              aria-describedby="profile-notes-hint"
            />
          </Field>

          <button type="submit" className="button button-primary button-large">
            <Wind aria-hidden="true" size={18} /> Build my clean-air plan
          </button>
        </form>
      </section>
    </div>
  );
}
