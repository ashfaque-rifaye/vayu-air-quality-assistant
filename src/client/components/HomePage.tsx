import { useRef, useState } from "react";
import { Clock3, Gauge, House, Leaf, MapPin, Trash2, Upload, Users } from "lucide-react";
import { pm25Band, pm25ToAqi } from "../../shared/aqi";
import { computeProtection, scoreLabel } from "../../shared/insights";
import type { Plan } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { MAX_IMPORT_BYTES, parsePlanBackup, type PlanStore } from "../lib/plan-store";
import { navigate, planHref } from "../lib/route";
import { IntakeFlow } from "./IntakeFlow";
import { AqiPill, ProgressBar } from "./ui";

const CAPABILITIES = [
  {
    icon: Clock3,
    title: "Low-emission routines",
    text: "An hour-by-hour plan built from today's smog forecast.",
  },
  {
    icon: House,
    title: "Indoor air hacks",
    text: "What actually clears the air you breathe at home.",
  },
  {
    icon: Leaf,
    title: "Sustainable swaps",
    text: "Cleaner choices, costed in emissions and exposure.",
  },
  {
    icon: Gauge,
    title: "The direct impact",
    text: "Every choice shows the PM2.5 dose it removes.",
  },
] as const;

function SavedPlanCard({ plan, onRemove }: { plan: Plan; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const { profile } = plan;
  const band = pm25Band(plan.air.averagePm25);
  const { score } = computeProtection(plan);
  return (
    <li className="plan-card" data-level={band.level}>
      <span className="plan-card-icon" aria-hidden="true">
        <House size={22} />
      </span>
      <div className="plan-card-body">
        <h3>
          <a href={planHref(plan.id)}>{profile.household}</a>
        </h3>
        <p className="plan-card-meta">
          <MapPin aria-hidden="true" size={14} /> {profile.city}
          <Users aria-hidden="true" size={14} /> {profile.members.length}{" "}
          {profile.members.length === 1 ? "person" : "people"}
        </p>
        <p className="plan-card-meta">
          <AqiPill aqi={pm25ToAqi(plan.air.averagePm25)} level={band.level} label={band.label} />
        </p>
        <ProgressBar value={score} label={`${profile.household} protection score`} />
        <p className="plan-card-score">
          {score}/100 · {scoreLabel(score)}
        </p>
      </div>
      {confirming ? (
        <div className="inline-confirm">
          <button type="button" className="button button-danger" onClick={onRemove}>
            Delete {profile.household}
          </button>
          <button type="button" className="button" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete ${profile.household}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden="true" size={18} />
        </button>
      )}
    </li>
  );
}

export function HomePage({ store, plans }: { store: PlanStore; plans: readonly Plan[] }) {
  const announce = useAnnounce();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");

  async function importBackup(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError("That file is too large to be a Vayu backup.");
      return;
    }
    const result = parsePlanBackup(await file.text());
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError("");
    store.add(result.plan);
    announce(`Imported ${result.plan.profile.household}`);
    navigate(planHref(result.plan.id));
  }

  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-inner">
          <p className="hero-eyebrow">
            Winter smog · Urban air pollution · Families &amp; communities
          </p>
          <h1 id="hero-title">
            Can&apos;t clear the air?
            <br />
            <em>Clear the plan.</em>
          </h1>
          <p className="hero-lead">
            Tell Vayu about your home and household. You get a low-emission daily routine, indoor
            air hacks and sustainable swaps made for your city and life, each one showing the exact
            PM2.5 dose it keeps out of your lungs.
          </p>
          <ul className="capabilities">
            {CAPABILITIES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="capability">
                <Icon aria-hidden="true" size={20} />
                <span>
                  <strong>{title}</strong>
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container home-body">
        <IntakeFlow store={store} />

        <section className="saved-plans" aria-labelledby="saved-title">
          <div className="section-heading">
            <h2 id="saved-title">Your households</h2>
            <button type="button" className="button" onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden="true" size={16} />
              Import backup
            </button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              aria-label="Import a Vayu plan backup"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
                event.target.value = "";
              }}
            />
          </div>
          {importError ? (
            <p className="callout callout-danger" role="alert">
              {importError}
            </p>
          ) : null}
          {plans.length === 0 ? (
            <p className="empty-note">
              Nothing here yet. Your first plan will appear here, in this browser only.
            </p>
          ) : (
            <ul className="plan-list">
              {plans.map((plan) => (
                <SavedPlanCard
                  key={plan.id}
                  plan={plan}
                  onRemove={() => {
                    store.remove(plan.id);
                    announce(`Deleted ${plan.profile.household}`);
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
