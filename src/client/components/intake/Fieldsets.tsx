/**
 * The household-details fieldsets. Each one edits its own slice of the form
 * through `update`, so the parent keeps one source of truth.
 */
import type { RefObject } from "react";
import { Plus, Trash2 } from "lucide-react";
import { LANGUAGE_NAMES } from "../../../shared/languages";
import {
  ACTIVITY_LEVELS,
  COMMUTE_MODES,
  CONCERNS,
  COOKING_FUELS,
  HEATING_TYPES,
  LANGUAGES,
  MAX_CONCERNS,
  SENSITIVITY_GROUPS,
  VENTILATION,
  type Concern,
} from "../../../shared/schemas";
import { describedBy, Field, SelectField } from "../ui";
import {
  ERROR_ORDER,
  newMember,
  withCommuteDefault,
  type FieldErrors,
  type FormState,
  type HomeState,
  type MemberRow,
} from "./form";
import {
  ACTIVITY_LABELS,
  COMMUTE_LABELS,
  CONCERN_LABELS,
  FUEL_LABELS,
  HEATING_LABELS,
  SENSITIVITY_LABELS,
  VENTILATION_LABELS,
} from "./labels";

/** Apply a change to the form, computed from its latest state. */
export type UpdateForm = (change: (form: FormState) => FormState) => void;

interface SectionProps {
  form: FormState;
  update: UpdateForm;
}

/** The list of what to fix, each a link that moves focus to its field. */
export function ErrorSummary({
  errors,
  summaryRef,
}: {
  errors: FieldErrors;
  summaryRef: RefObject<HTMLDivElement | null>;
}) {
  const entries = ERROR_ORDER.flatMap((key) =>
    errors[key] ? [{ key, message: errors[key] }] : [],
  );
  if (entries.length === 0) return null;
  return (
    <div className="callout callout-danger" role="alert" ref={summaryRef} tabIndex={-1}>
      <p>
        <strong>Please fix {entries.length === 1 ? "this" : "these"} to continue:</strong>
      </p>
      <ul>
        {entries.map(({ key, message }) => (
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
  );
}

/** Name, city, day and language. */
export function BasicsFields({ form, update, errors }: SectionProps & { errors: FieldErrors }) {
  const text = (key: "household" | "city" | "date") => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => {
      const value = event.target.value;
      update((c) => ({ ...c, [key]: value }));
    },
  });
  return (
    <div className="form-grid">
      <Field id="profile-household" label="Household name" error={errors.household}>
        <input
          id="profile-household"
          type="text"
          maxLength={80}
          placeholder="The Khan family"
          {...text("household")}
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
          {...text("city")}
          {...describedBy("profile-city", { hint: true, error: errors.city })}
        />
      </Field>
      <Field id="profile-date" label="Day to plan for" error={errors.date}>
        <input
          id="profile-date"
          type="date"
          {...text("date")}
          {...describedBy("profile-date", { error: errors.date })}
        />
      </Field>
      <SelectField
        id="profile-language"
        label="Language for AI advice"
        hint="Vayu's menus stay in English."
        value={form.language}
        options={LANGUAGES}
        labels={LANGUAGE_NAMES}
        onChange={(language) => update((c) => ({ ...c, language }))}
      />
    </div>
  );
}

function MemberFields({
  member,
  index,
  removable,
  update,
}: {
  member: MemberRow;
  index: number;
  removable: boolean;
  update: UpdateForm;
}) {
  const edit = (patch: Partial<MemberRow>) =>
    update((c) => ({
      ...c,
      members: c.members.map((m) => (m.id === member.id ? { ...m, ...patch } : m)),
    }));
  return (
    <li className="member-row">
      <Field id={`member-label-${member.id}`} label={`Person ${index + 1}`}>
        <input
          id={`member-label-${member.id}`}
          type="text"
          maxLength={40}
          value={member.label}
          onChange={(event) => edit({ label: event.target.value })}
        />
      </Field>
      <SelectField
        id={`member-group-${member.id}`}
        label="Sensitivity"
        value={member.group}
        options={SENSITIVITY_GROUPS}
        labels={SENSITIVITY_LABELS}
        onChange={(group) => edit({ group })}
      />
      {removable ? (
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${member.label || `person ${index + 1}`}`}
          onClick={() =>
            update((c) => ({ ...c, members: c.members.filter((m) => m.id !== member.id) }))
          }
        >
          <Trash2 aria-hidden="true" size={18} />
        </button>
      ) : null}
    </li>
  );
}

/** Who lives here, and how sensitive each person is to smog. */
export function MembersFieldset({ form, update, error }: SectionProps & { error?: string }) {
  return (
    <fieldset className="subform" id="profile-members">
      <legend>Who lives here?</legend>
      <p className="field-hint">The most sensitive person sets how carefully Vayu plans. {error}</p>
      <ul className="member-list">
        {form.members.map((member, index) => (
          <MemberFields
            key={member.id}
            member={member}
            index={index}
            removable={form.members.length > 1}
            update={update}
          />
        ))}
      </ul>
      <button
        type="button"
        className="button"
        onClick={() => update((c) => ({ ...c, members: [...c.members, newMember()] }))}
      >
        <Plus aria-hidden="true" size={16} /> Add a person
      </button>
    </fieldset>
  );
}

/** How the home holds, makes and filters indoor air. */
export function HomeFieldset({ form, update }: SectionProps) {
  const setHome = <K extends keyof HomeState>(key: K, value: HomeState[K]) =>
    update((c) => ({ ...c, home: { ...c.home, [key]: value } }));
  const { home } = form;
  return (
    <fieldset className="subform">
      <legend>Your home</legend>
      <div className="form-grid">
        <SelectField
          id="home-ventilation"
          label="How airtight is it?"
          value={home.ventilation}
          options={VENTILATION}
          labels={VENTILATION_LABELS}
          onChange={(value) => setHome("ventilation", value)}
        />
        <SelectField
          id="home-cooking"
          label="Cooking fuel"
          value={home.cookingFuel}
          options={COOKING_FUELS}
          labels={FUEL_LABELS}
          onChange={(value) => setHome("cookingFuel", value)}
        />
        <SelectField
          id="home-heating"
          label="Winter heating"
          value={home.heating}
          options={HEATING_TYPES}
          labels={HEATING_LABELS}
          onChange={(value) => setHome("heating", value)}
        />
        <Field id="home-room" label="Main room size (m²)">
          <input
            id="home-room"
            type="number"
            inputMode="numeric"
            min={4}
            value={home.roomSqm}
            onChange={(event) => setHome("roomSqm", event.target.value)}
          />
        </Field>
      </div>
      <div className="checkbox-grid">
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={home.nearRoad}
            onChange={(event) => setHome("nearRoad", event.target.checked)}
          />
          We live next to a busy road
        </label>
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={home.hasPurifier}
            onChange={(event) => setHome("hasPurifier", event.target.checked)}
          />
          We already have an air purifier
        </label>
      </div>
      {home.hasPurifier ? (
        <CadrField value={home.purifierCadr} onChange={(value) => setHome("purifierCadr", value)} />
      ) : null}
    </fieldset>
  );
}

/** The purifier's clean-air delivery rate, which sizes how much it can clean. */
function CadrField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby="home-cadr-hint"
      />
    </Field>
  );
}

function TimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      <input id={id} type="time" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

/** The commute and outdoor exercise: when the household is out in the air. */
export function RoutineFieldset({ form, update }: SectionProps) {
  const set = (patch: Partial<FormState>) => update((c) => ({ ...c, ...patch }));
  return (
    <fieldset className="subform">
      <legend>Daily routine</legend>
      <div className="form-grid">
        <SelectField
          id="commute-mode"
          label="How do you commute?"
          value={form.commuteMode}
          options={COMMUTE_MODES}
          labels={COMMUTE_LABELS}
          onChange={(commuteMode) => update((c) => withCommuteDefault({ ...c, commuteMode }))}
        />
        {form.commuteMode !== "none" ? (
          <>
            <Field id="commute-minutes" label="Minutes each way">
              <input
                id="commute-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.commuteMinutes}
                onChange={(event) => set({ commuteMinutes: event.target.value })}
              />
            </Field>
            <TimeField
              id="commute-time"
              label="Leaves home at"
              value={form.commuteTime}
              onChange={(commuteTime) => set({ commuteTime })}
            />
          </>
        ) : null}
        <SelectField
          id="outdoor-activity"
          label="Outdoor exercise"
          value={form.outdoorActivity}
          options={ACTIVITY_LEVELS}
          labels={ACTIVITY_LABELS}
          onChange={(outdoorActivity) => set({ outdoorActivity })}
        />
        {form.outdoorActivity !== "none" ? (
          <TimeField
            id="outdoor-time"
            label="Usually at"
            value={form.outdoorTime}
            onChange={(outdoorTime) => set({ outdoorTime })}
          />
        ) : null}
      </div>
    </fieldset>
  );
}

/** Up to three priorities, which weight the advice and the protection score. */
export function ConcernsFieldset({ form, update }: SectionProps) {
  const full = form.concerns.length >= MAX_CONCERNS;
  const toggle = (concern: Concern) =>
    update((c) => ({
      ...c,
      concerns: c.concerns.includes(concern)
        ? c.concerns.filter((item) => item !== concern)
        : [...c.concerns, concern],
    }));
  return (
    <fieldset className="priority-picker">
      <legend>What matters most? Choose up to {MAX_CONCERNS}.</legend>
      <p className="field-hint">Vayu weights its advice and your protection score toward these.</p>
      <div className="checkbox-grid">
        {CONCERNS.map((concern) => {
          const checked = form.concerns.includes(concern);
          return (
            <label key={concern} className="checkbox-option">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && full}
                onChange={() => toggle(concern)}
              />
              {CONCERN_LABELS[concern]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
