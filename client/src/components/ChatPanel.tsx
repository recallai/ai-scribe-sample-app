import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { ChatMessage } from "../types";
import { Icon } from "./Icon";
import { Panel } from "./Panel";

type DisplayMessage = ChatMessage & { timestamps?: number[] };

function timestamp(seconds: number): string {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Mount with key={visit.id} so the thread resets when the selection changes.
export function ChatPanel({ visitId, enabled, onSeek }: {
  visitId: string;
  enabled: boolean;
  onSeek: (seconds: number) => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, pending]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;
    const history = messages;
    setMessages([...history, { role: "user", content: trimmed }]);
    setDraft("");
    setPending(true);
    setError(null);
    try {
      const { answer, timestamps } = await api.chat(visitId, trimmed, history);
      setMessages((current) => [...current, { role: "assistant", content: answer, timestamps }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <Panel title="Ask about this visit" flush>
      <div className="chat">
      <div className="chat__thread" ref={threadRef}>
        {messages.length === 0 && !pending ? (
          <p className="muted">
            {enabled ? "Ask about this visit." : "Available when the transcript is ready."}
          </p>
        ) : null}
        {messages.map((message, index) => (
          <div className={`chat__msg chat__msg--${message.role}`} key={index}>
            {message.content}
            {message.role === "assistant" && message.timestamps?.length ? (
              <div className="chat__sources">
                {message.timestamps.map((seconds) => (
                  <button
                    type="button"
                    className="timestamp-link"
                    key={seconds}
                    onClick={() => onSeek(seconds)}
                  >
                    {timestamp(seconds)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {pending ? (
          <div className="chat__msg chat__msg--assistant typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {error ? <div className="banner banner--danger">{error}</div> : null}
      </div>

      <form className="chat__form" onSubmit={submit}>
        <textarea
          className="input"
          rows={2}
          placeholder={enabled ? "Ask a question…" : "Waiting for transcript"}
          value={draft}
          disabled={!enabled || pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          aria-label="Question"
        />
        <button
          type="submit"
          className="btn btn--primary btn--icon"
          disabled={!enabled || pending || !draft.trim()}
          aria-label="Send"
        >
          <Icon name="send" size={16} />
        </button>
      </form>
      </div>
    </Panel>
  );
}
