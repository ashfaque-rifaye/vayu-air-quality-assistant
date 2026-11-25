import { useState } from "react";
import { Bookmark, BookmarkCheck, Leaf, Sparkles, Wind } from "lucide-react";
import { formatDose } from "../../shared/exposure";
import { buildAirContext, profileForAi } from "../../shared/plan-context";
import { useAnnounce } from "../lib/announcer";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import type { Language, Swap } from "../../shared/schemas";
import { AiStatus, Field, Why } from "./ui";

/** One swap, with its impact shown twice: on the planet and on the lungs. */
function SwapCard({
  swap,
  language,
  onToggleSaved,
}: {
  swap: Swap;
  language: Language;
  onToggleSaved: () => void;
}) {
  const SaveIcon = swap.saved ? BookmarkCheck : Bookmark;
  return (
    <li className={swap.saved ? "swap-card saved" : "swap-card"} data-testid="swap-card">
      <div className="swap-head">
        <span className="chip-tag">{swap.category}</span>
        <h4 lang={language}>{swap.title}</h4>
      </div>
      <p lang={language}>{swap.description}</p>
      <p className="swap-impact">
        <span className="impact-badge impact-co2">
          <Leaf aria-hidden="true" size={14} /> −{swap.co2eKgPerWeek} kg CO₂e/week
        </span>
        <span className="impact-badge impact-dose">
          <Wind aria-hidden="true" size={14} /> −{formatDose(swap.exposureReductionPerDay)}/day
        </span>
      </p>
      <Why text={swap.why} language={language} />
      <button
        type="button"
        className={swap.saved ? "button button-primary button-small" : "button button-small"}
        onClick={onToggleSaved}
      >
        <SaveIcon aria-hidden="true" size={15} /> {swap.saved ? "Saved" : "Save"}
      </button>
    </li>
  );
}

export default function SwapsPanel({ plan, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const { state, run } = useAi("swaps");
  const [steer, setSteer] = useState("");
  const { language } = plan.profile;

  async function generate(): Promise<void> {
    const envelope = await run({
      profile: profileForAi(plan.profile),
      air: buildAirContext(plan.air),
      steer,
      exclude: plan.swaps.map((swap) => swap.title),
    });
    if (envelope) {
      dispatch({ type: "setSwaps", swaps: envelope.data.swaps });
      announce("Fresh swaps ready");
    }
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Swaps</h2>

      <section className="card card-ai" aria-labelledby="swaps-title">
        <div className="card-heading">
          <h3 id="swaps-title">
            <Leaf aria-hidden="true" size={18} /> Sustainable swaps for your household
          </h3>
          <button
            type="button"
            className="button button-primary"
            disabled={state.status === "loading"}
            onClick={() => void generate()}
          >
            <Sparkles aria-hidden="true" size={16} />{" "}
            {plan.swaps.length > 0 ? "Fresh ideas" : "Suggest swaps"}
          </button>
        </div>
        <p className="muted">
          Low-emission alternatives that fit your routine. Each shows its direct impact: the
          emissions it avoids and the exposure it cuts. Saved swaps stay when you regenerate.
        </p>
        <Field
          id="swaps-steer"
          label="Steer the swaps (optional)"
          hint="For example: focus on cooking, or things that cost nothing."
        >
          <input
            id="swaps-steer"
            type="text"
            maxLength={200}
            value={steer}
            onChange={(event) => setSteer(event.target.value)}
            aria-describedby="swaps-steer-hint"
          />
        </Field>

        <AiStatus
          state={state}
          loading="Vayu is finding swaps for you…"
          onRetry={() => void generate()}
        />

        {plan.swaps.length === 0 ? (
          <p className="empty-note">No swaps yet. Suggest some to get started.</p>
        ) : (
          <ul className="swap-list">
            {plan.swaps.map((swap) => (
              <SwapCard
                key={swap.id}
                swap={swap}
                language={language}
                onToggleSaved={() => {
                  dispatch({ type: "toggleSwapSaved", id: swap.id });
                  announce(swap.saved ? "Removed from saved" : `Saved: ${swap.title}`);
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
