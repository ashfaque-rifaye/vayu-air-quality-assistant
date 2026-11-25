import { useState, type FormEvent } from "react";
import { AlertTriangle, Lightbulb, Plus, Sparkles, Trash2 } from "lucide-react";
import { formatDose, measureImpact } from "../../shared/exposure";
import { MEASURE_SHORT_LABELS, MEASURE_TEMPLATES } from "../../shared/knowledge";
import { buildAirContext, profileForAi } from "../../shared/plan-context";
import {
  MEASURE_CATEGORIES,
  MEASURE_STATUSES,
  type Language,
  type Measure,
  type MeasureCategory,
  type MeasureGuide,
  type MeasureStatus,
} from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { ErrorNote, Field, Loading, SelectField, Why } from "./ui";

const STATUS_LABELS: Record<MeasureStatus, string> = {
  suggested: "Suggested",
  planned: "Planned",
  done: "Done",
  dismissed: "Not for us",
};

type Dispatch = PanelProps["dispatch"];

/** Status, and removal for measures the person or the AI added (templates stay). */
function StatusRow({ measure, dispatch }: { measure: Measure; dispatch: Dispatch }) {
  const announce = useAnnounce();
  return (
    <div className="measure-status-row">
      <SelectField
        id={`status-${measure.id}`}
        label="Status"
        value={measure.status}
        options={MEASURE_STATUSES}
        labels={STATUS_LABELS}
        onChange={(status) => {
          dispatch({ type: "setMeasureStatus", id: measure.id, status });
          announce(`${measure.label}: ${STATUS_LABELS[status]}`);
        }}
      />
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
  );
}

/** How to do the measure well, as steps to tick off. */
function Checklist({ measure, dispatch }: { measure: Measure; dispatch: Dispatch }) {
  const done = measure.checks.filter((check) => check.done).length;
  return (
    <details className="measure-checklist">
      <summary>
        How to do it well ({done}/{measure.checks.length})
      </summary>
      <ul>
        {measure.checks.map((check) => (
          <li key={check.id}>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={check.done}
                onChange={() =>
                  dispatch({ type: "toggleMeasureCheck", measureId: measure.id, checkId: check.id })
                }
              />
              <span className={check.done ? "struck" : undefined}>{check.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The AI's guidance for this home: what to look for, what to avoid, and one tip. */
function Guide({ guide, language }: { guide: MeasureGuide; language: Language }) {
  return (
    <div className="measure-guide" data-testid="measure-guide">
      <h5>
        <Lightbulb aria-hidden="true" size={15} /> What to look for
      </h5>
      <ul>
        {guide.whatToLookFor.map((point) => (
          <li key={point} lang={language}>
            {point}
          </li>
        ))}
      </ul>
      {guide.redFlags.length > 0 ? (
        <>
          <h5>
            <AlertTriangle aria-hidden="true" size={15} /> Watch out for
          </h5>
          <ul>
            {guide.redFlags.map((flag) => (
              <li key={flag} lang={language}>
                {flag}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p lang={language}>
        <strong>Tip: </strong>
        {guide.tip}
      </p>
      <Why text={guide.reasoning} language={language} />
    </div>
  );
}

function MeasureCard({
  measure,
  impact,
  language,
  dispatch,
  guiding,
  onGuide,
}: {
  measure: Measure;
  impact: number;
  language: Language;
  dispatch: Dispatch;
  guiding: boolean;
  onGuide: () => void;
}) {
  const { blurb } = MEASURE_TEMPLATES[measure.category];
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
      <p className="muted">{blurb}</p>
      {measure.why ? <Why text={measure.why} language={language} /> : null}
      <p className="measure-meta">
        <span>
          {measure.cost === null
            ? "Free / behaviour"
            : `Approx. ₹${measure.cost.toLocaleString("en-IN")}`}
        </span>
        <span>·</span>
        <span>{measure.effortDays === 0 ? "Start today" : `~${measure.effortDays} day setup`}</span>
      </p>
      <StatusRow measure={measure} dispatch={dispatch} />
      <Checklist measure={measure} dispatch={dispatch} />
      <div className="measure-ai">
        <button type="button" className="button button-small" disabled={guiding} onClick={onGuide}>
          <Sparkles aria-hidden="true" size={14} />{" "}
          {measure.guide ? "Guidance again" : "Get tailored guidance"}
        </button>
        {guiding ? <Loading>Vayu is tailoring this for your home…</Loading> : null}
        {measure.guide ? <Guide guide={measure.guide} language={language} /> : null}
      </div>
    </li>
  );
}

/** A measure of the household's own, with the type that sets its checklist. */
function AddMeasure({ dispatch }: { dispatch: Dispatch }) {
  const announce = useAnnounce();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<MeasureCategory>("monitoring");

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!label.trim()) return;
    dispatch({ type: "addMeasure", label, category, source: "you" });
    announce(`Added measure: ${label}`);
    setLabel("");
  }

  return (
    <section className="card" aria-labelledby="add-measure-title">
      <h3 id="add-measure-title">Add your own measure</h3>
      <form className="inline-form" onSubmit={submit}>
        <Field id="measure-label" label="What will you do?">
          <input
            id="measure-label"
            type="text"
            maxLength={100}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <SelectField
          id="measure-category"
          label="Type"
          value={category}
          options={MEASURE_CATEGORIES}
          labels={MEASURE_SHORT_LABELS}
          onChange={setCategory}
        />
        <button type="submit" className="button" disabled={!label.trim()}>
          <Plus aria-hidden="true" size={16} /> Add
        </button>
      </form>
    </section>
  );
}

export default function MeasuresPanel({ plan, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const { state, run } = useAi("measure");
  const [guidingId, setGuidingId] = useState<string | null>(null);
  const base = { profile: plan.profile, home: plan.profile.home, air: plan.air };
  const impactOf = (measure: Measure) => measureImpact(measure.category, base);
  const sorted = [...plan.measures].sort((a, b) => impactOf(b) - impactOf(a));

  async function getGuidance(measure: Measure): Promise<void> {
    setGuidingId(measure.id);
    const envelope = await run({
      profile: profileForAi(plan.profile),
      air: buildAirContext(plan.air),
      measureLabel: measure.label,
      category: measure.category,
    });
    setGuidingId(null);
    if (!envelope) return;
    const { whatToLookFor, redFlags, tip, reasoning } = envelope.data;
    dispatch({
      type: "setMeasureGuide",
      id: measure.id,
      guide: { whatToLookFor, redFlags, tip, reasoning },
    });
    announce("Guidance ready");
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Measures</h2>
      <section className="card" aria-labelledby="measures-title">
        <h3 id="measures-title">Protect your home, biggest win first</h3>
        <p className="muted">
          Each measure shows its direct impact: the PM2.5 dose it keeps out of your lungs each day.
          Mark one <strong>Done</strong> once it is in place to raise your protection score.
        </p>
        {/* Progress shows on the card being guided; only a failure is reported here. */}
        {state.status === "error" ? <ErrorNote message={state.message} /> : null}
        <ul className="measure-list">
          {sorted.map((measure) => (
            <MeasureCard
              key={measure.id}
              measure={measure}
              impact={impactOf(measure)}
              language={plan.profile.language}
              dispatch={dispatch}
              guiding={guidingId === measure.id}
              onGuide={() => void getGuidance(measure)}
            />
          ))}
        </ul>
      </section>
      <AddMeasure dispatch={dispatch} />
    </div>
  );
}
