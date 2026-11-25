import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { MAX_INTERPRET_TEXT, type AiEnvelope } from "../../../shared/contracts";
import type { AiState } from "../../lib/use-ai";
import { AiBadge, ErrorNote, Field, Loading, Why } from "../ui";
import { EXAMPLES } from "./labels";

const MIN_DESCRIPTION = 3;

function BulletList({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

/** What the AI read from the description: who answered, why, what it assumed and still needs. */
function DraftResult({ envelope }: { envelope: AiEnvelope<"interpret"> }) {
  const { reasoning, assumptions, questions } = envelope.data;
  return (
    <div className="ai-result" data-testid="interpret-result">
      <AiBadge meta={envelope} />
      <Why text={reasoning} />
      <BulletList title="What Vayu assumed" items={assumptions} />
      <BulletList title="Still needed from you" items={questions} />
    </div>
  );
}

/** Step 1: describe the household in your own words and let the AI fill in the form. */
export function DescribeStep({
  state,
  onDescribe,
}: {
  state: AiState<"interpret">;
  onDescribe: (text: string) => void;
}) {
  const [description, setDescription] = useState("");
  const tooShort = description.trim().length < MIN_DESCRIPTION;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!tooShort) onDescribe(description);
  }

  return (
    <section className="card card-raised intake-describe" aria-labelledby="describe-title">
      <p className="step-label">Step 1 · Optional, but it saves typing</p>
      <h2 id="describe-title">
        <Sparkles aria-hidden="true" size={22} /> Describe your home and household in your own words
      </h2>
      <form onSubmit={submit}>
        <Field
          id="household-description"
          label="Tell Vayu about your situation"
          hint="Mention your city, who lives with you (and any children, older adults or health conditions), how you cook and heat, and your daily routine."
        >
          <textarea
            id="household-description"
            rows={4}
            maxLength={MAX_INTERPRET_TEXT}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-describedby="household-description-hint"
          />
        </Field>
        <div className="chip-row" role="group" aria-label="Example descriptions">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              className="chip"
              onClick={() => setDescription(example.text)}
            >
              Try: {example.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          className="button button-primary"
          disabled={state.status === "loading" || tooShort}
        >
          <Sparkles aria-hidden="true" size={16} />
          Fill in the details with AI
        </button>
      </form>

      <div aria-live="polite">
        {state.status === "loading" ? <Loading>Vayu is reading your description…</Loading> : null}
        {state.status === "error" ? <ErrorNote message={state.message} /> : null}
        {state.status === "success" ? <DraftResult envelope={state.envelope} /> : null}
      </div>
    </section>
  );
}
