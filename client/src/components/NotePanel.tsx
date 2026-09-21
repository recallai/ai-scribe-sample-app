import { useEffect, useState } from "react";
import { NOTE_FORMAT_LABEL, formatDateTime } from "../format";
import type { NoteFormat, VisitView } from "../types";
import { Icon } from "./Icon";
import { Panel, PanelEmpty } from "./Panel";

const FORMATS: NoteFormat[] = ["soap", "dap", "birp"];

function noteToText(visit: VisitView): string {
  if (!visit.note) return "";
  return visit.note.sections.map((s) => `${s.heading}\n${s.content}`).join("\n\n");
}

export function NotePanel({
  visit,
  busy,
  onRegenerate,
}: {
  visit: VisitView;
  busy: boolean;
  onRegenerate: (format: NoteFormat) => Promise<void>;
}) {
  const [format, setFormat] = useState<NoteFormat>(visit.note?.format ?? visit.noteFormat);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setFormat(visit.note?.format ?? visit.noteFormat);
  }, [visit.id, visit.note?.format, visit.noteFormat]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(noteToText(visit));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the button just stays as-is.
    }
  }

  const canRegenerate = Boolean(visit.transcript) && !busy;
  const formatChanged = visit.note ? format !== visit.note.format : false;

  const actions = (
    <>
      <select
        className="select select--inline"
        value={format}
        aria-label="Note format"
        disabled={!visit.transcript || busy}
        onChange={(e) => setFormat(e.target.value as NoteFormat)}
      >
        {FORMATS.map((f) => (
          <option key={f} value={f}>
            {NOTE_FORMAT_LABEL[f]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`btn btn--sm${formatChanged ? " btn--primary" : ""}`}
        disabled={!canRegenerate}
        onClick={() => void onRegenerate(format)}
        title={visit.transcript ? "Generate the note again" : "Available once the transcript is ready"}
      >
        {busy ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        {formatChanged ? `Rewrite as ${NOTE_FORMAT_LABEL[format]}` : "Regenerate"}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={!visit.note}
        onClick={() => void copy()}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
        {copied ? "Copied" : "Copy"}
      </button>
    </>
  );

  let body;
  if (visit.note) {
    body = (
      <div className="note">
        {visit.note.sections.map((section) => (
          <div className="note__section" key={section.heading}>
            <div className="note__marker" aria-hidden="true">
              {section.heading[0]}
            </div>
            <div>
              <div className="note__heading">{section.heading}</div>
              <p className="note__content">{section.content}</p>
            </div>
          </div>
        ))}
        <div className="note__meta">
          <span>Drafted {formatDateTime(visit.note.generatedAt)}</span>
          <span className="grow" />
          <span>Draft — review before use</span>
        </div>
      </div>
    );
  } else if (visit.aiError) {
    body = <PanelEmpty>The transcript is still available below. Try regenerating.</PanelEmpty>;
  } else if (visit.transcript || visit.status === "processing") {
    body = (
      <PanelEmpty>
        <div className="row" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{visit.transcript ? "Drafting clinical note…" : "Waiting for transcript…"}</span>
        </div>
      </PanelEmpty>
    );
  } else if (visit.status === "failed" || visit.status === "cancelled") {
    body = <PanelEmpty>No transcript was produced for this visit.</PanelEmpty>;
  } else {
    body = (
      <PanelEmpty>
        <span>Note available after the transcript is ready.</span>
      </PanelEmpty>
    );
  }

  return (
    <Panel
      title="Clinical note"
      chip={visit.note ? <span className="chip chip--accent">{NOTE_FORMAT_LABEL[visit.note.format]}</span> : null}
      actions={actions}
      flush
    >
      {visit.aiError && (
        <div className="banner banner--danger">
          <strong>Note generation failed.</strong> {visit.aiError.message}
          {visit.note && " Showing the previous note."}
        </div>
      )}
      {body}
    </Panel>
  );
}
