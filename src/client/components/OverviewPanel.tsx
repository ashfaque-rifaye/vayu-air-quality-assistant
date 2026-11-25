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
import type { Plan } from "../../shared/schemas";
import { SENSITIVITY_LABELS } from "./intake/labels";
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

/** The protection score, and the four numbers behind it. */
function ProtectionCard({ plan }: { plan: Plan }) {
  const protection = computeProtection(plan);
  const exposure = planExposure(plan);
  const stillAvoidable = Math.max(0, exposure.reductionPossible - exposure.reductionAchieved);
  const sensitive = SENSITIVITY_LABELS[mostVulnerable(plan)].toLowerCase();
  return (
    <section className="card readiness" aria-labelledby="protection-title">
      <ProgressRing value={protection.score} label="Protection score" />
      <div className="readiness-body">
        <h3 id="protection-title">
          Protection: {protection.score}/100 · {scoreLabel(protection.score)}
        </h3>
        <p className="muted">
          How much of the exposure you can avoid is actually in place, weighted toward your most
          sensitive member: the {sensitive}.
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
            value={formatDose(stillAvoidable)}
            detail="per day"
          />
        </dl>
      </div>
    </section>
  );
}

/** What the AI added for this household, and why. */
function TailoredCard({ plan }: { plan: Plan }) {
  const { personalization } = plan;
  if (!personalization) return null;
  const { language } = plan.profile;
  const added = [
    ...plan.measures
      .filter((measure) => measure.source === "ai")
      .map((measure) => ({ ...measure, title: measure.label, note: "Added to measures" })),
    ...plan.routine
      .filter((item) => item.source === "ai")
      .map((item) => ({ ...item, note: `Routine, ${item.time}` })),
  ];
  return (
    <section
      className="card card-ai"
      aria-labelledby="tailored-title"
      data-testid="personalization"
    >
      <div className="card-heading">
        <h3 id="tailored-title">
          <Sparkles aria-hidden="true" size={18} /> Tailored for your household
        </h3>
        <AiBadge meta={personalization} />
      </div>
      <p lang={language}>{personalization.summary}</p>
      <Why text={personalization.reasoning} language={language} />
      {added.length > 0 ? (
        <ul className="tailored-list">
          {added.map((item) => (
            <li key={item.id}>
              <strong lang={language}>{item.title}</strong>{" "}
              <span className="muted">{item.note}</span>
              {item.why ? <Why text={item.why} language={language} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Explainable risks, each with a link to where it is fixed. */
function RisksCard({ plan }: { plan: Plan }) {
  const risks = detectRisks(plan);
  return (
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
  );
}

/** The measures that would remove the most dose, each one click from done. */
function NextWinsCard({ plan, dispatch }: Pick<PanelProps, "plan" | "dispatch">) {
  const announce = useAnnounce();
  const next = nextMeasures(plan);
  return (
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
  );
}

function PlanActions({ plan }: { plan: Plan }) {
  const announce = useAnnounce();
  return (
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
  );
}

export function OverviewPanel({
  plan,
  dispatch,
  personalizing = false,
  personalizeError = null,
  onRetry,
}: OverviewProps) {
  return (
    <div className="stack">
      <h2 className="sr-only">Overview</h2>
      <ProtectionCard plan={plan} />
      <div aria-live="polite">
        {personalizing ? <Loading>Vayu is tailoring your plan…</Loading> : null}
        {personalizeError ? (
          <ErrorNote message={personalizeError} {...(onRetry ? { onRetry } : {})} />
        ) : null}
        <TailoredCard plan={plan} />
      </div>
      <div className="two-column">
        <RisksCard plan={plan} />
        <NextWinsCard plan={plan} dispatch={dispatch} />
      </div>
      <PlanActions plan={plan} />
    </div>
  );
}
