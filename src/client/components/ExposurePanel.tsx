import { useState } from "react";
import { Cigarette, Download, Gauge, RotateCcw, ShieldCheck, Sparkles, Target } from "lucide-react";
import { pm25Band, pm25ToAqi } from "../../shared/aqi";
import { cigarettes, formatDose, planExposure } from "../../shared/exposure";
import { exposureToCsv } from "../../shared/exports";
import { buildPlanContext } from "../../shared/plan-context";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, AqiPill, ErrorNote, Field, Loading, Stat, Why } from "./ui";

/** A PM2.5 input that commits on blur, so typing does not recompute on each key. */
function Pm25Input({ value, onCommit }: { value: number; onCommit: (amount: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
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
      onBlur={() => {
        if (draft !== null) {
          const amount = Number(draft);
          if (draft.trim() !== "" && Number.isFinite(amount) && amount >= 0) onCommit(amount);
          setDraft(null);
        }
      }}
    />
  );
}

export default function ExposurePanel({ plan, today, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const { state, run } = useAi("review");
  const exposure = planExposure(plan);
  const { language } = plan.profile;
  const { air } = plan;
  const review = plan.review;
  const band = pm25Band(air.averagePm25);
  const compareMax = Math.max(1, exposure.baselineDose);
  const largestSegment = Math.max(1, ...exposure.segments.map((s) => s.dose));
  const labelFor = (id: string) => plan.measures.find((m) => m.id === id)?.label ?? id;

  async function askForReview(): Promise<void> {
    const envelope = await run({ context: buildPlanContext(plan, today) });
    if (envelope) {
      dispatch({ type: "setReview", review: { ...envelope.data, source: envelope.source } });
      announce("Exposure review ready");
    }
  }

  const bars = [
    { id: "baseline", label: "Doing nothing", dose: exposure.baselineDose, tone: "bar-danger" },
    { id: "now", label: "Your plan now", dose: exposure.totalDose, tone: "bar-now" },
    { id: "protected", label: "Fully protected", dose: exposure.protectedDose, tone: "bar-ok" },
    { id: "target", label: "WHO safe target", dose: exposure.targetDose, tone: "bar-target" },
  ];

  return (
    <div className="stack">
      <h2 className="sr-only">Exposure</h2>

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
            value={formatDose(Math.max(0, exposure.reductionPossible - exposure.reductionAchieved))}
            detail="adopt more measures"
          />
        </dl>
        <p className="muted">
          Dose is PM2.5 concentration × time × how hard you breathe, in µg/m³·h. It is a transparent
          model to compare choices, not a medical measurement.
        </p>
      </section>

      <section className="card" aria-labelledby="exposure-compare-title">
        <h3 id="exposure-compare-title">The difference your choices make</h3>
        <ul className="compare-bars">
          {bars.map((bar) => (
            <li key={bar.id}>
              <span className="compare-label">{bar.label}</span>
              <span className="compare-track" aria-hidden="true">
                <span
                  className={`compare-fill ${bar.tone}`}
                  style={{ width: `${Math.min(100, (bar.dose / compareMax) * 100)}%` }}
                />
              </span>
              <span className="compare-value">
                {formatDose(bar.dose)} <small>≈ {cigarettes(bar.dose)} cig/day</small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="air-control-title">
        <h3 id="air-control-title">Today's air</h3>
        <p className="air-now">
          <AqiPill aqi={pm25ToAqi(air.averagePm25)} level={band.level} label={band.label} />
          <span className="muted">
            {air.source === "manual" ? "Your figure" : `Modelled for ${plan.profile.city}`} ·{" "}
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
          {air.source === "manual" ? (
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

      <section className="card" aria-labelledby="exposure-segments-title">
        <h3 id="exposure-segments-title">Where the dose comes from</h3>
        <ul className="dose-bars">
          {[...exposure.segments]
            .sort((a, b) => b.dose - a.dose)
            .map((segment) => (
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
                    style={{ width: `${(segment.dose / largestSegment) * 100}%` }}
                  />
                </span>
              </li>
            ))}
        </ul>
      </section>

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
            {review ? "Review again" : "Review my exposure"}
          </button>
        </div>
        <div aria-live="polite">
          {state.status === "loading" ? <Loading>Vayu is reviewing your exposure…</Loading> : null}
          {state.status === "error" ? (
            <ErrorNote message={state.message} onRetry={() => void askForReview()} />
          ) : null}
          {review ? (
            <div data-testid="exposure-review">
              <AiBadge
                meta={state.status === "success" ? state.envelope : { source: review.source }}
              />
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
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            dispatch({
                              type: "setMeasureStatus",
                              id: move.measureId,
                              status: "done",
                            });
                            dispatch({
                              type: "setReview",
                              review: {
                                ...review,
                                moves: review.moves.filter((candidate) => candidate !== move),
                              },
                            });
                            announce(`Adopted ${labelFor(move.measureId)}`);
                          }}
                        >
                          Mark this done
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
