/**
 * The two-step intake: describe the household in your own words (optional, AI),
 * then check the details and build the plan. The form state lives here; the rules
 * are in `intake/form.ts` and each fieldset is its own component.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Wind } from "lucide-react";
import { todayIso } from "../../shared/dates";
import { createPlan } from "../../shared/plan";
import { useAnnounce } from "../lib/announcer";
import type { PlanStore } from "../lib/plan-store";
import { navigate, planHref } from "../lib/route";
import { useAi } from "../lib/use-ai";
import { DescribeStep } from "./intake/DescribeStep";
import {
  BasicsFields,
  ConcernsFieldset,
  ErrorSummary,
  HomeFieldset,
  MembersFieldset,
  RoutineFieldset,
  type UpdateForm,
} from "./intake/Fieldsets";
import {
  applyDraft,
  emptyForm,
  validateForm,
  type FieldErrors,
  type FormState,
} from "./intake/form";
import { Field } from "./ui";

export function IntakeFlow({ store }: { store: PlanStore }) {
  const announce = useAnnounce();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failedSubmits, setFailedSubmits] = useState(0);
  const errorSummary = useRef<HTMLDivElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const { state: draftState, run: runDraft } = useAi("interpret");
  const update: UpdateForm = useCallback((change) => setForm(change), []);

  // After a failed submit, move focus to the summary so the errors are announced.
  useEffect(() => {
    if (failedSubmits > 0) errorSummary.current?.focus();
  }, [failedSubmits]);

  async function draftFromDescription(text: string): Promise<void> {
    const envelope = await runDraft({ text });
    if (!envelope) return;
    setForm((current) => applyDraft(current, envelope.data.profile));
    setErrors({});
    announce("Details filled in. Check them below, then create your plan.");
    formHeading.current?.focus();
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
    const today = todayIso();
    store.add(createPlan(result.profile, { id, today, now: new Date().toISOString() }));
    navigate(planHref(id));
  }

  return (
    <div className="intake">
      <DescribeStep state={draftState} onDescribe={(text) => void draftFromDescription(text)} />

      <section className="card" aria-labelledby="details-title">
        <p className="step-label">Step 2 · Check the details</p>
        <h2 id="details-title" ref={formHeading} tabIndex={-1}>
          Household details
        </h2>
        <form noValidate onSubmit={createFromForm}>
          <ErrorSummary errors={errors} summaryRef={errorSummary} />
          <BasicsFields form={form} update={update} errors={errors} />
          <MembersFieldset
            form={form}
            update={update}
            {...(errors.members ? { error: errors.members } : {})}
          />
          <HomeFieldset form={form} update={update} />
          <RoutineFieldset form={form} update={update} />
          <ConcernsFieldset form={form} update={update} />
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
              onChange={(event) => {
                const notes = event.target.value;
                update((c) => ({ ...c, notes }));
              }}
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
