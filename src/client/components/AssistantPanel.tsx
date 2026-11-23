import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Send, Wind, X } from "lucide-react";
import { MAX_CHAT_HISTORY, MAX_CHAT_TEXT } from "../../shared/contracts";
import { buildPlanContext } from "../../shared/plan-context";
import type { Plan, PlanProposal } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Field, Loading, Why } from "./ui";

const SUGGESTIONS = [
  "What should I do first today?",
  "How risky is the air for my most sensitive member?",
  "What is the cheapest way to cut our exposure?",
];

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

export default function AssistantPanel({ plan, today, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState("");
  const { state, run } = useAi("chat");
  const logEnd = useRef<HTMLDivElement>(null);
  const { language } = plan.profile;
  const lastMeta = state.status === "success" ? state.envelope : null;

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [plan.chat.length, state.status]);

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    setDraft("");
    const history = plan.chat
      .slice(-MAX_CHAT_HISTORY)
      .map(({ role, text: content }) => ({ role, text: content.slice(0, 2000) }));
    dispatch({ type: "appendChat", message: { role: "user", text: message } });
    const envelope = await run({ context: buildPlanContext(plan, today), history, message });
    if (envelope) {
      const { reply, reasoning, proposals } = envelope.data;
      dispatch({
        type: "appendChat",
        message: { role: "assistant", text: reply, reasoning, source: envelope.source, proposals },
      });
    }
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Ask Vayu</h2>
      <section className="card chat" aria-labelledby="chat-title">
        <h3 id="chat-title">Ask Vayu about your air and plan</h3>
        <p className="muted">
          Vayu knows today's air, your household and your measures. Any change it suggests only
          happens if you approve it. For symptoms or health decisions, see a clinician.
        </p>

        <div className="chat-log" role="log" aria-label="Conversation with Vayu" tabIndex={0}>
          {plan.chat.length === 0 ? (
            <p className="muted">No messages yet. Try a suggestion below.</p>
          ) : null}
          {plan.chat.map((message) => (
            <article
              key={message.id}
              className={message.role === "user" ? "bubble bubble-user" : "bubble bubble-vayu"}
              aria-label={message.role === "user" ? "You said" : "Vayu said"}
              data-testid={`chat-${message.role}`}
            >
              {message.role === "assistant" ? (
                <span className="avatar" aria-hidden="true">
                  <Wind size={14} />
                </span>
              ) : null}
              <p lang={message.role === "assistant" ? language : undefined}>{message.text}</p>
              {message.source ? <AiBadge meta={{ source: message.source }} /> : null}
              {message.reasoning ? <Why text={message.reasoning} language={language} /> : null}
              {message.proposals?.map((proposal, index) => (
                <div
                  key={describeProposal(proposal, plan)}
                  className="proposal"
                  data-testid="proposal"
                >
                  <p>
                    <strong>Suggested change: </strong>
                    {describeProposal(proposal, plan)}
                  </p>
                  <Why text={proposal.why} language={language} />
                  <div className="button-row">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => {
                        dispatch({ type: "applyProposal", messageId: message.id, index });
                        announce(`Applied: ${describeProposal(proposal, plan)}`);
                      }}
                    >
                      <Check aria-hidden="true" size={16} />
                      Apply<span className="sr-only">: {describeProposal(proposal, plan)}</span>
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        dispatch({ type: "dismissProposal", messageId: message.id, index });
                        announce("Suggestion dismissed");
                      }}
                    >
                      <X aria-hidden="true" size={16} />
                      Dismiss<span className="sr-only">: {describeProposal(proposal, plan)}</span>
                    </button>
                  </div>
                </div>
              ))}
            </article>
          ))}
          <div ref={logEnd} />
        </div>

        <div aria-live="polite">
          {state.status === "loading" ? <Loading>Vayu is thinking…</Loading> : null}
          {state.status === "error" ? <ErrorNote message={state.message} /> : null}
          {lastMeta?.sanitized ? <AiBadge meta={lastMeta} /> : null}
          {lastMeta?.fallbackReason && !lastMeta.sanitized ? <AiBadge meta={lastMeta} /> : null}
        </div>

        <div className="chip-row" role="group" aria-label="Suggested questions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="chip"
              disabled={state.status === "loading"}
              onClick={() => void send(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <form
          className="inline-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void send(draft);
          }}
        >
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
          <button
            type="submit"
            className="button button-primary"
            disabled={state.status === "loading" || !draft.trim()}
          >
            <Send aria-hidden="true" size={16} />
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
