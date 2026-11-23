import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cigarette,
  Download,
  Gauge,
  Printer,
  ShieldCheck,
  Sparkles,
  Wind,
} from "lucide-react";
import { cigarettes, formatDose, planExposure } from "../../shared/exposure";
import { planToJson } from "../../shared/exports";
import {
  computeProtection,
  detectRisks,
  mostVulnerable,
  nextMeasures,
  scoreLabel,
} from "../../shared/insights";
import { SENSITIVITY_LABELS } from "./IntakeFlow";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { planHref } from "../lib/route";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Loading, ProgressRing, Stat, Why } from "./ui";

interface OverviewProps extends PanelProps {
  personalizing?: boolean;
  personalizeError?: string | null;
  onRetry?: () => void;
}

export function OverviewPanel({
  plan,
  dispatch,
  personalizing = false,
  personalizeError = null,
  onRetry,
}: OverviewProps) {
  const announce = useAnnounce();
  const protection = computeProtection(plan);
  const exposure = planExposure(plan);
  const risks = detectRisks(plan);
  const next = nextMeasures(plan);
  const { language } = plan.profile;
  const aiMeasures = plan.measures.filter((measure) => measure.source === "ai");
  const aiRoutine = plan.routine.filter((item) => item.source === "ai");

  return (
    <div className="stack">
      <h2 className="sr-only">Overview</h2>

      <section className="card readiness" aria-labelledby="protection-title">
        <ProgressRing value={protection.score} label="Protection score" />
        <div className="readiness-body">
          <h3 id="protection-title">
            Protection: {protection.score}/100 · {scoreLabel(protection.score)}
          </h3>
          <p className="muted">
            How much of the exposure you can avoid is actually in place, weighted toward your most
            sensitive member: the {SENSITIVITY_LABELS[mostVulnerable(plan)].toLowerCase()}.
          </p>
          <dl className="stat-grid">
            <Stat
              icon={Gauge}
              label="Today's exposure"
              value={formatDose(exposure.totalDose)}
              detail={`~${exposure.timesTarget}× the safe limit`}
            />
            <Stat
              icon={Cigarette}
              label="Roughly like"
              value={`${cigarettes(exposure.totalDose)}/day`}
              detail="cigarette-equivalents"
            />
            <Stat
              icon={ShieldCheck}
              label="Measures in place"
              value={`${protection.measuresDone} of ${protection.measuresTotal}`}
            />
            <Stat
              icon={Wind}
              label="Still avoidable"
              value={formatDose(
                Math.max(0, exposure.reductionPossible - exposure.reductionAchieved),
              )}
              detail="per day"
            />
          </dl>
        </div>
      </section>

      <div aria-live="polite">
        {personalizing ? <Loading>Vayu is tailoring your plan…</Loading> : null}
        {personalizeError ? <ErrorNote message={personalizeError} onRetry={onRetry} /> : null}
        {plan.personalization ? (
          <section
            className="card card-ai"
            aria-labelledby="tailored-title"
            data-testid="personalization"
          >
            <div className="card-heading">
              <h3 id="tailored-title">
                <Sparkles aria-hidden="true" size={18} /> Tailored for your household
              </h3>
              <AiBadge meta={plan.personalization} />
            </div>
            <p lang={language}>{plan.personalization.summary}</p>
            <Why text={plan.personalization.reasoning} language={language} />
            {aiMeasures.length + aiRoutine.length > 0 ? (
              <ul className="tailored-list">
                {aiMeasures.map((measure) => (
                  <li key={measure.id}>
                    <strong lang={language}>{measure.label}</strong>{" "}
                    <span className="muted">Added to measures</span>
                    {measure.why ? <Why text={measure.why} language={language} /> : null}
                  </li>
                ))}
                {aiRoutine.map((item) => (
                  <li key={item.id}>
                    <strong lang={language}>{item.title}</strong>{" "}
                    <span className="muted">Routine, {item.time}</span>
                    {item.why ? <Why text={item.why} language={language} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="two-column">
        <section className="card" aria-labelledby="risks-title">
          <h3 id="risks-title">Risks to watch</h3>
          {risks.length === 0 ? (
            <p className="callout callout-ok">
              <CheckCircle2 aria-hidden="true" size={18} /> Your top protections are in place.
            </p>
          ) : (
            <ul className="risk-list">
              {risks.map((risk) => (
                <li key={risk.id} className={`risk risk-${risk.severity}`}>
                  <AlertTriangle aria-hidden="true" size={18} />
                  <div>
                    <p>
                      <strong>{risk.severity === "high" ? "High: " : "Watch: "}</strong>
                      {risk.title}
                    </p>
                    <p className="muted">{risk.why}</p>
                    <a href={planHref(plan.id, risk.tab)}>
                      Open {risk.tab} <ArrowRight aria-hidden="true" size={14} />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="next-title">
          <h3 id="next-title">Biggest wins left</h3>
          {next.length === 0 ? (
            <p>Every measure in your plan is adopted. Keep to your routine.</p>
          ) : (
            <ul className="action-list">
              {next.map((measure) => (
                <li key={measure.id}>
                  <span>
                    {measure.label}
                    {measure.impact > 0 ? (
                      <span className="tag tag-impact">−{formatDose(measure.impact)}/day</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => {
                      dispatch({ type: "setMeasureStatus", id: measure.id, status: "done" });
                      announce(`Marked done: ${measure.label}`);
                    }}
                  >
                    Mark done
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="button-row no-print">
        <button
          type="button"
          className="button"
          onClick={() => {
            downloadText(
              `${slugify(plan.profile.household)}-vayu-plan.json`,
              planToJson(plan),
              "application/json",
            );
            announce("Backup downloaded");
          }}
        >
          <Download aria-hidden="true" size={16} />
          Download backup
        </button>
        <button type="button" className="button" onClick={() => window.print()}>
          <Printer aria-hidden="true" size={16} />
          Print this page
        </button>
      </div>
    </div>
  );
}
