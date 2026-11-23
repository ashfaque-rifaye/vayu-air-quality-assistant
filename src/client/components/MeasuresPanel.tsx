import { useState, type FormEvent } from "react";
import { AlertTriangle, Lightbulb, Plus, Sparkles, Trash2 } from "lucide-react";
import { measureImpact } from "../../shared/exposure";
import { formatDose } from "../../shared/exposure";
import { MEASURE_SHORT_LABELS, MEASURE_TEMPLATES } from "../../shared/knowledge";
import { buildAirContext, profileForAi } from "../../shared/plan-context";
import {
  MEASURE_CATEGORIES,
  MEASURE_STATUSES,
  type Measure,
  type MeasureCategory,
  type MeasureStatus,
} from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { ErrorNote, Field, Loading, Why } from "./ui";

const STATUS_LABELS: Record<MeasureStatus, string> = {
  suggested: "Suggested",
  planned: "Planned",
  done: "Done",
  dismissed: "Not for us",
};

function MeasureCard({
  measure,
  impact,
  plan,
  dispatch,
  guiding,
  onGuide,
}: {
  measure: Measure;
  impact: number;
  plan: PanelProps["plan"];
  dispatch: PanelProps["dispatch"];
  guiding: boolean;
  onGuide: () => void;
}) {
  const announce = useAnnounce();
  const { language } = plan.profile;
  const template = MEASURE_TEMPLATES[measure.category];
  const doneChecks = measure.checks.filter((check) => check.done).length;

  return (
    <li className={`measure-card status-${measure.status}`} data-testid="measure-card">
      <div className="measure-head">
        <div>
          <span className={`chip-tag chip-${measure.category}`}>
            {MEASURE_SHORT_LABELS[measure.category]}
          </span>
          <h4 lang={measure.source === "ai" ? language : undefined}>{measure.label}</h4>
        </div>
        {impact > 0 ? (
          <span className="measure-impact" title="Direct impact on your daily inhaled dose">
            −{formatDose(impact)}
            <small>/day</small>
          </span>
        ) : null}
      </div>
      <p className="muted">{template.blurb}</p>
      {measure.why ? <Why text={measure.why} language={language} /> : null}
      <p className="measure-meta">
        {measure.cost !== null ? (
          <span>Approx. ₹{measure.cost.toLocaleString("en-IN")}</span>
        ) : (
          <span>Free / behaviour</span>
        )}
        <span>·</span>
        <span>{measure.effortDays === 0 ? "Start today" : `~${measure.effortDays} day setup`}</span>
      </p>

      <div className="measure-status-row">
        <Field id={`status-${measure.id}`} label="Status">
          <select
            id={`status-${measure.id}`}
            value={measure.status}
            onChange={(event) => {
              dispatch({
                type: "setMeasureStatus",
                id: measure.id,
                status: event.target.value as MeasureStatus,
              });
              announce(`${measure.label}: ${STATUS_LABELS[event.target.value as MeasureStatus]}`);
            }}
          >
            {MEASURE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </Field>
        {measure.source !== "template" ? (
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${measure.label}`}
            onClick={() => {
              dispatch({ type: "removeMeasure", id: measure.id });
              announce("Measure removed");
            }}
          >
            <Trash2 aria-hidden="true" size={18} />
          </button>
        ) : null}
      </div>

      <details className="measure-checklist">
        <summary>
          How to do it well ({doneChecks}/{measure.checks.length})
        </summary>
        <ul>
          {measure.checks.map((check) => (
            <li key={check.id}>
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={check.done}
                  onChange={() =>
                    dispatch({
                      type: "toggleMeasureCheck",
                      measureId: measure.id,
                      checkId: check.id,
                    })
                  }
                />
                <span className={check.done ? "struck" : undefined}>{check.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </details>

      <div className="measure-ai">
        <button type="button" className="button button-small" disabled={guiding} onClick={onGuide}>
          <Sparkles aria-hidden="true" size={14} />{" "}
          {measure.guide ? "Guidance again" : "Get tailored guidance"}
        </button>
        {guiding ? <Loading>Vayu is tailoring this for your home…</Loading> : null}
        {measure.guide ? (
          <div className="measure-guide" data-testid="measure-guide">
            <h5>
              <Lightbulb aria-hidden="true" size={15} /> What to look for
            </h5>
            <ul>
              {measure.guide.whatToLookFor.map((point) => (
                <li key={point} lang={language}>
                  {point}
                </li>
              ))}
            </ul>
            {measure.guide.redFlags.length > 0 ? (
              <>
                <h5>
                  <AlertTriangle aria-hidden="true" size={15} /> Watch out for
                </h5>
                <ul>
                  {measure.guide.redFlags.map((flag) => (
                    <li key={flag} lang={language}>
                      {flag}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p lang={language}>
              <strong>Tip: </strong>
              {measure.guide.tip}
            </p>
            <Why text={measure.guide.reasoning} language={language} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function MeasuresPanel({ plan, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const { state, run } = useAi("measure");
  const [guidingId, setGuidingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState<MeasureCategory>("monitoring");
  const base = { profile: plan.profile, home: plan.profile.home, air: plan.air };

  async function getGuidance(measure: Measure): Promise<void> {
    setGuidingId(measure.id);
    const envelope = await run({
      profile: profileForAi(plan.profile),
      air: buildAirContext(plan.air),
      measureLabel: measure.label,
      category: measure.category,
    });
    setGuidingId(null);
    if (envelope) {
      const { whatToLookFor, redFlags, tip, reasoning } = envelope.data;
      dispatch({
        type: "setMeasureGuide",
        id: measure.id,
        guide: { whatToLookFor, redFlags, tip, reasoning },
      });
      announce("Guidance ready");
    }
  }

  function addMeasure(event: FormEvent): void {
    event.preventDefault();
    if (!newLabel.trim()) return;
    dispatch({ type: "addMeasure", label: newLabel, category: newCategory, source: "you" });
    announce(`Added measure: ${newLabel}`);
    setNewLabel("");
  }

  const sorted = [...plan.measures].sort(
    (a, b) => measureImpact(b.category, base) - measureImpact(a.category, base),
  );

  return (
    <div className="stack">
      <h2 className="sr-only">Measures</h2>

      <section className="card" aria-labelledby="measures-title">
        <h3 id="measures-title">Protect your home, biggest win first</h3>
        <p className="muted">
          Each measure shows its direct impact: the PM2.5 dose it keeps out of your lungs each day.
          Mark one <strong>Done</strong> once it is in place to raise your protection score.
        </p>
        {state.status === "error" ? <ErrorNote message={state.message} /> : null}
        <ul className="measure-list">
          {sorted.map((measure) => (
            <MeasureCard
              key={measure.id}
              measure={measure}
              impact={measureImpact(measure.category, base)}
              plan={plan}
              dispatch={dispatch}
              guiding={guidingId === measure.id}
              onGuide={() => void getGuidance(measure)}
            />
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="add-measure-title">
        <h3 id="add-measure-title">Add your own measure</h3>
        <form className="inline-form" onSubmit={addMeasure}>
          <Field id="measure-label" label="What will you do?">
            <input
              id="measure-label"
              type="text"
              maxLength={100}
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
            />
          </Field>
          <Field id="measure-category" label="Type">
            <select
              id="measure-category"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value as MeasureCategory)}
            >
              {MEASURE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {MEASURE_SHORT_LABELS[category]}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="button" disabled={!newLabel.trim()}>
            <Plus aria-hidden="true" size={16} /> Add
          </button>
        </form>
      </section>
    </div>
  );
}
