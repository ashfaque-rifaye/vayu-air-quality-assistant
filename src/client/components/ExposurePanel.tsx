import { useState } from "react";
import { Cigarette, Download, Gauge, RotateCcw, ShieldCheck, Sparkles, Target } from "lucide-react";
import { pm25Band, pm25ToAqi } from "../../shared/aqi";
import { cigarettes, formatDose, planExposure } from "../../shared/exposure";
import { exposureToCsv } from "../../shared/exports";
import { buildPlanContext } from "../../shared/plan-context";
import type { ExposureReview, Plan } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { useAi, type AiState } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, AiStatus, AqiPill, Field, Stat, Why } from "./ui";

type Exposure = ReturnType<typeof planExposure>;

/** A PM2.5 input that commits on blur, so typing does not recompute on each key. */
function Pm25Input({ value, onCommit }: { value: number; onCommit: (amount: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(): void {
    if (draft === null) return;
    const amount = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(amount) && amount >= 0) onCommit(amount);
    setDraft(null);
  }

  return (
    <input
      id="air-average"
      className="money-input"
      type="number"
      inputMode="numeric"
      min={0}
      // Named by its visible <label>, so what is spoken matches what is shown.
      aria-describedby="air-average-hint"
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
    />
  );
}

/** Today's dose in four numbers, and a CSV of the whole model for anyone who wants it. */
function SummaryCard({ plan, exposure }: { plan: Plan; exposure: Exposure }) {
  const announce = useAnnounce();
  const stillAvoidable = Math.max(0, exposure.reductionPossible - exposure.reductionAchieved);
  return (
    <section className="card" aria-labelledby="exposure-summary-title">
      <div className="card-heading">
        <h3 id="exposure-summary-title">What your household breathes today</h3>
        <button
          type="button"
          className="button"
          onClick={() => {
            downloadText(
              `${slugify(plan.profile.household)}-exposure.csv`,
              exposureToCsv(plan),
              "text/csv",
            );
            announce("Exposure CSV downloaded");
          }}
        >
          <Download aria-hidden="true" size={16} />
          Export CSV
        </button>
      </div>
      <dl className="stat-grid">
        <Stat
          icon={Gauge}
          label="Inhaled dose today"
          value={formatDose(exposure.totalDose)}
          detail={`~${exposure.timesTarget}× the safe target`}
        />
        <Stat
          icon={Cigarette}
          label="Roughly like"
          value={`${cigarettes(exposure.totalDose)}/day`}
          detail="cigarette-equivalents"
        />
        <Stat
          icon={ShieldCheck}
          label="Already avoided"
          value={formatDose(exposure.reductionAchieved)}
          detail="vs doing nothing"
        />
        <Stat
          icon={Target}
          label="Still avoidable"
          value={formatDose(stillAvoidable)}
          detail="adopt more measures"
        />
      </dl>
      <p className="muted">
        Dose is PM2.5 concentration × time × how hard you breathe, in µg/m³·h. It is a transparent
        model to compare choices, not a medical measurement.
      </p>
    </section>
  );
}

/** Doing nothing, the plan now, fully protected and the safe target, side by side. */
function CompareCard({ exposure }: { exposure: Exposure }) {
  const bars = [
    { id: "baseline", label: "Doing nothing", dose: exposure.baselineDose, tone: "bar-danger" },
    { id: "now", label: "Your plan now", dose: exposure.totalDose, tone: "bar-now" },
    { id: "protected", label: "Fully protected", dose: exposure.protectedDose, tone: "bar-ok" },
    { id: "target", label: "WHO safe target", dose: exposure.targetDose, tone: "bar-target" },
  ];
  const max = Math.max(1, exposure.baselineDose);
  return (
    <section className="card" aria-labelledby="exposure-compare-title">
      <h3 id="exposure-compare-title">The difference your choices make</h3>
      <ul className="compare-bars">
        {bars.map((bar) => (
          <li key={bar.id}>
            <span className="compare-label">{bar.label}</span>
            <span className="compare-track" aria-hidden="true">
              <span
                className={`compare-fill ${bar.tone}`}
                style={{ width: `${Math.min(100, (bar.dose / max) * 100)}%` }}
              />
            </span>
            <span className="compare-value">
              {formatDose(bar.dose)} <small>≈ {cigarettes(bar.dose)} cig/day</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The day's air, modelled for the city or set from a local monitor reading. */
function AirCard({ plan, dispatch }: Pick<PanelProps, "plan" | "dispatch">) {
  const announce = useAnnounce();
  const { air } = plan;
  const band = pm25Band(air.averagePm25);
  const manual = air.source === "manual";
  return (
    <section className="card" aria-labelledby="air-control-title">
      <h3 id="air-control-title">Today&apos;s air</h3>
      <p className="air-now">
        <AqiPill aqi={pm25ToAqi(air.averagePm25)} level={band.level} label={band.label} />
        <span className="muted">
          {manual ? "Your figure" : `Modelled for ${plan.profile.city}`} ·{" "}
          {Math.round(air.averagePm25)} µg/m³ daily mean
        </span>
      </p>
      <p className="muted">{band.advice}</p>
      <div className="air-control">
        <Field
          id="air-average"
          label="Set today's average PM2.5 (µg/m³)"
          hint="Enter a reading from your city's monitor to see your real exposure."
        >
          <Pm25Input
            value={Math.round(air.averagePm25)}
            onCommit={(amount) => {
              dispatch({ type: "setAirAverage", amount });
              announce(`Air set to ${Math.round(amount)} micrograms`);
            }}
          />
        </Field>
        {manual ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              dispatch({ type: "resetAir" });
              announce("Reset to the modelled forecast");
            }}
          >
            <RotateCcw aria-hidden="true" size={16} /> Reset to model
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Where the dose comes from, biggest first, indoor and outdoor marked apart. */
function SegmentsCard({ exposure }: { exposure: Exposure }) {
  const largest = Math.max(1, ...exposure.segments.map((s) => s.dose));
  const segments = [...exposure.segments].sort((a, b) => b.dose - a.dose);
  return (
    <section className="card" aria-labelledby="exposure-segments-title">
      <h3 id="exposure-segments-title">Where the dose comes from</h3>
      <ul className="dose-bars">
        {segments.map((segment) => (
          <li key={segment.id}>
            <span className="dose-bar-label">
              {segment.label}
              <small className="muted">
                {" "}
                · {segment.hours}h {segment.place}, {segment.effectivePm25} µg/m³
              </small>
            </span>
            <span className="dose-bar-value">{formatDose(segment.dose)}</span>
            <span className="dose-bar-track" aria-hidden="true">
              <span
                className={`dose-bar-allocated ${segment.place === "outdoor" ? "seg-outdoor" : "seg-indoor"}`}
                style={{ width: `${(segment.dose / largest) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The AI's advice, and the measures it suggests adopting next, one click each. */
function ReviewResult({
  plan,
  review,
  state,
  dispatch,
}: Pick<PanelProps, "plan" | "dispatch"> & { review: ExposureReview; state: AiState<"review"> }) {
  const announce = useAnnounce();
  const { language } = plan.profile;
  const labelFor = (id: string) => plan.measures.find((m) => m.id === id)?.label ?? id;

  function adopt(move: ExposureReview["moves"][number]): void {
    dispatch({ type: "setMeasureStatus", id: move.measureId, status: "done" });
    const moves = review.moves.filter((candidate) => candidate !== move);
    dispatch({ type: "setReview", review: { ...review, moves } });
    announce(`Adopted ${labelFor(move.measureId)}`);
  }

  return (
    <div data-testid="exposure-review">
      <AiBadge meta={state.status === "success" ? state.envelope : { source: review.source }} />
      <Why text={review.reasoning} language={language} />
      <ul className="advice-list">
        {review.advice.map((item) => (
          <li key={item.title} lang={language}>
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </li>
        ))}
      </ul>
      {review.moves.length > 0 ? (
        <>
          <h4>Suggested next steps</h4>
          <ul className="advice-list">
            {review.moves.map((move) => (
              <li key={move.measureId}>
                <p>
                  <strong>Adopt: {labelFor(move.measureId)}</strong>
                </p>
                <Why text={move.why} language={language} />
                <button type="button" className="button" onClick={() => adopt(move)}>
                  Mark this done
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ReviewCard({ plan, today, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const { state, run } = useAi("review");

  async function askForReview(): Promise<void> {
    const envelope = await run({ context: buildPlanContext(plan, today) });
    if (!envelope) return;
    dispatch({ type: "setReview", review: { ...envelope.data, source: envelope.source } });
    announce("Exposure review ready");
  }

  return (
    <section className="card card-ai" aria-labelledby="exposure-ai-title">
      <div className="card-heading">
        <h3 id="exposure-ai-title">Ask Vayu to review your exposure</h3>
        <button
          type="button"
          className="button button-primary"
          disabled={state.status === "loading"}
          onClick={() => void askForReview()}
        >
          <Sparkles aria-hidden="true" size={16} />
          {plan.review ? "Review again" : "Review my exposure"}
        </button>
      </div>
      <AiStatus
        state={state}
        loading="Vayu is reviewing your exposure…"
        onRetry={() => void askForReview()}
        showSource={false}
      />
      {plan.review ? (
        <ReviewResult plan={plan} review={plan.review} state={state} dispatch={dispatch} />
      ) : null}
    </section>
  );
}

export default function ExposurePanel(props: PanelProps) {
  const exposure = planExposure(props.plan);
  return (
    <div className="stack">
      <h2 className="sr-only">Exposure</h2>
      <SummaryCard plan={props.plan} exposure={exposure} />
      <CompareCard exposure={exposure} />
      <AirCard plan={props.plan} dispatch={props.dispatch} />
      <SegmentsCard exposure={exposure} />
      <ReviewCard {...props} />
    </div>
  );
}
