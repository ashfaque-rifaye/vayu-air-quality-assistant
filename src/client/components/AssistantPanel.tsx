import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Send, Wind, X } from "lucide-react";
import { MAX_CHAT_HISTORY, MAX_CHAT_TEXT } from "../../shared/contracts";
import { buildPlanContext } from "../../shared/plan-context";
import type { ChatMessage, Language, Plan, PlanProposal } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Field, Loading, Why } from "./ui";

const SUGGESTIONS = [
  "What should I do first today?",
  "How risky is the air for my most sensitive member?",
  "What is the cheapest way to cut our exposure?",
];

/** The longest a past message may be when it is sent back as history. */
const HISTORY_TEXT_LIMIT = 2000;

function describeProposal(proposal: PlanProposal, plan: Plan): string {
  switch (proposal.type) {
    case "addMeasure":
      return `Add measure: ${proposal.label}`;
    case "addRoutineItem":
      return `Add reminder at ${proposal.time}: ${proposal.title}`;
    case "adoptMeasure": {
      const label = plan.measures.find((m) => m.id === proposal.measureId)?.label ?? "a measure";
      return `Mark done: ${label}`;
    }
  }
}

/** A change the assistant suggests. Nothing happens unless the person applies it. */
function ProposalCard({
  description,
  why,
  language,
  onApply,
  onDismiss,
}: {
  description: string;
  why: string;
  language: Language;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="proposal" data-testid="proposal">
      <p>
        <strong>Suggested change: </strong>
        {description}
      </p>
      <Why text={why} language={language} />
      <div className="button-row">
        <button type="button" className="button button-primary" onClick={onApply}>
          <Check aria-hidden="true" size={16} />
          Apply<span className="sr-only">: {description}</span>
        </button>
        <button type="button" className="button" onClick={onDismiss}>
          <X aria-hidden="true" size={16} />
          Dismiss<span className="sr-only">: {description}</span>
        </button>
      </div>
    </div>
  );
}

function Bubble({
  message,
  plan,
  dispatch,
}: {
  message: ChatMessage;
  plan: Plan;
  dispatch: PanelProps["dispatch"];
}) {
  const announce = useAnnounce();
  const { language } = plan.profile;
  const fromVayu = message.role === "assistant";
  return (
    <article
      className={fromVayu ? "bubble bubble-vayu" : "bubble bubble-user"}
      aria-label={fromVayu ? "Vayu said" : "You said"}
      data-testid={`chat-${message.role}`}
    >
      {fromVayu ? (
        <span className="avatar" aria-hidden="true">
          <Wind size={14} />
        </span>
      ) : null}
      <p lang={fromVayu ? language : undefined}>{message.text}</p>
      {message.source ? <AiBadge meta={{ source: message.source }} /> : null}
      {message.reasoning ? <Why text={message.reasoning} language={language} /> : null}
      {message.proposals?.map((proposal, index) => {
        const description = describeProposal(proposal, plan);
        return (
          <ProposalCard
            key={description}
            description={description}
            why={proposal.why}
            language={language}
            onApply={() => {
              dispatch({ type: "applyProposal", messageId: message.id, index });
              announce(`Applied: ${description}`);
            }}
            onDismiss={() => {
              dispatch({ type: "dismissProposal", messageId: message.id, index });
              announce("Suggestion dismissed");
            }}
          />
        );
      })}
    </article>
  );
}

function Composer({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    onSend(draft);
    setDraft("");
  }

  return (
    <>
      <div className="chip-row" role="group" aria-label="Suggested questions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => onSend(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <form className="inline-form" onSubmit={submit}>
        <Field id="chat-input" label="Your question">
          <input
            id="chat-input"
            type="text"
            maxLength={MAX_CHAT_TEXT}
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <button type="submit" className="button button-primary" disabled={busy || !draft.trim()}>
          <Send aria-hidden="true" size={16} />
          Send
        </button>
      </form>
    </>
  );
}

export default function AssistantPanel({ plan, today, dispatch }: PanelProps) {
  const { state, run } = useAi("chat");
  const logEnd = useRef<HTMLDivElement>(null);
  const lastMeta = state.status === "success" ? state.envelope : null;
  // Worth flagging only when the input was cleaned or the built-in planner answered.
  const showMeta = Boolean(lastMeta?.sanitized || lastMeta?.fallbackReason);

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [plan.chat.length, state.status]);

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    const history = plan.chat
      .slice(-MAX_CHAT_HISTORY)
      .map(({ role, text: content }) => ({ role, text: content.slice(0, HISTORY_TEXT_LIMIT) }));
    dispatch({ type: "appendChat", message: { role: "user", text: message } });
    const envelope = await run({ context: buildPlanContext(plan, today), history, message });
    if (!envelope) return;
    const { reply, reasoning, proposals } = envelope.data;
    dispatch({
      type: "appendChat",
      message: { role: "assistant", text: reply, reasoning, source: envelope.source, proposals },
    });
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Ask Vayu</h2>
      <section className="card chat" aria-labelledby="chat-title">
        <h3 id="chat-title">Ask Vayu about your air and plan</h3>
        <p className="muted">
          Vayu knows today&apos;s air, your household and your measures. Any change it suggests only
          happens if you approve it. For symptoms or health decisions, see a clinician.
        </p>

        <div className="chat-log" role="log" aria-label="Conversation with Vayu" tabIndex={0}>
          {plan.chat.length === 0 ? (
            <p className="muted">No messages yet. Try a suggestion below.</p>
          ) : null}
          {plan.chat.map((message) => (
            <Bubble key={message.id} message={message} plan={plan} dispatch={dispatch} />
          ))}
          <div ref={logEnd} />
        </div>

        <div aria-live="polite">
          {state.status === "loading" ? <Loading>Vayu is thinking…</Loading> : null}
          {state.status === "error" ? <ErrorNote message={state.message} /> : null}
          {lastMeta && showMeta ? <AiBadge meta={lastMeta} /> : null}
        </div>

        <Composer busy={state.status === "loading"} onSend={(text) => void send(text)} />
      </section>
    </div>
  );
}
