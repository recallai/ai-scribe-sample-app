import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { NOTE_FORMAT_LABEL, formatDateTime, localInputToIso } from "../format";
import type { NewVisitInput, NoteFormat, UpcomingEvent } from "../types";

const DEFAULT_KEY_TERMS = "lisinopril, metformin, atorvastatin";
const FORMATS: NoteFormat[] = ["soap", "dap", "birp"];

export function NewVisitDialog({
  open,
  defaultFormat,
  defaultRecordVideo,
  calendarEvent,
  onClose,
  onSubmit,
}: {
  open: boolean;
  defaultFormat: NoteFormat;
  defaultRecordVideo: boolean;
  calendarEvent?: UpcomingEvent;
  onClose: () => void;
  onSubmit: (input: NewVisitInput) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [patientName, setPatientName] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [joinAt, setJoinAt] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [keyTerms, setKeyTerms] = useState(DEFAULT_KEY_TERMS);
  const [noteFormat, setNoteFormat] = useState<NoteFormat>(defaultFormat);
  const [recordVideo, setRecordVideo] = useState(defaultRecordVideo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const visit = calendarEvent?.visit;
    setPatientName(visit?.patientName ?? "");
    setScheduled(false);
    setJoinAt("");
    setKeyTerms(visit?.keyTerms.join(", ") ?? DEFAULT_KEY_TERMS);
    setNoteFormat(visit?.noteFormat ?? defaultFormat);
    setRecordVideo(visit?.recordVideo ?? defaultRecordVideo);
    setError(null);
  }, [open, calendarEvent, defaultFormat, defaultRecordVideo]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!calendarEvent && !patientName.trim()) {
      setError("Enter a patient name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        meetingUrl: calendarEvent?.meetingUrl ?? meetingUrl.trim(),
        patientName: patientName.trim(),
        joinAt: calendarEvent?.startTime ?? (scheduled ? localInputToIso(joinAt) : null),
        keyTerms: keyTerms
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        noteFormat,
        recordVideo,
      });
      setMeetingUrl("");
      setJoinAt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="dialog__head">
          <h2>{calendarEvent?.visit ? "Visit settings" : "New visit"}</h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="dialog__body">
          {calendarEvent && (
            <div>
              <strong>{calendarEvent.title}</strong>
              <div className="muted">
                {formatDateTime(calendarEvent.startTime)} · Bot joins
                automatically
              </div>
            </div>
          )}
          <div className="field">
            <label className="field__label" htmlFor="patientName">
              Patient name {calendarEvent && <span className="muted">(optional)</span>}
            </label>
            <input
              id="patientName"
              className="input"
              required={!calendarEvent}
              autoFocus
              placeholder="Full name"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
          </div>

          <div className="form-grid">
            {!calendarEvent && (
              <div className="field field--full">
                <label className="field__label" htmlFor="meetingUrl">
                  Meeting URL
                </label>
                <input
                  id="meetingUrl"
                  className="input"
                  type="url"
                  required
                  placeholder="https://zoom.us/j/123…"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                />
              </div>
            )}

            {!calendarEvent && (
              <div className="field field--full">
                <div className="segmented" role="radiogroup" aria-label="When to join">
                  <button type="button" role="radio" aria-checked={!scheduled}
                    className={`segmented__opt${!scheduled ? " segmented__opt--active" : ""}`}
                    onClick={() => setScheduled(false)}>
                    Join now
                  </button>
                  <button type="button" role="radio" aria-checked={scheduled}
                    className={`segmented__opt${scheduled ? " segmented__opt--active" : ""}`}
                    onClick={() => setScheduled(true)}>
                    Schedule
                  </button>
                </div>
                {scheduled && (
                  <>
                    <label className="field__label" htmlFor="joinAt">Date and time</label>
                    <input id="joinAt" className="input" type="datetime-local" required
                      value={joinAt} onChange={(e) => setJoinAt(e.target.value)} />
                  </>
                )}
              </div>
            )}

            <div className="field field--full">
              <label className="field__label" htmlFor="keyTerms">
                Key terms <span className="muted">(optional)</span>
              </label>
              <input
                id="keyTerms"
                className="input"
                value={keyTerms}
                onChange={(e) => setKeyTerms(e.target.value)}
              />
            </div>

            <div className="field field--full">
              <span className="field__label">Note format</span>
              <div
                className="segmented"
                role="radiogroup"
                aria-label="Note format"
              >
                {FORMATS.map((format) => (
                  <button
                    key={format}
                    type="button"
                    role="radio"
                    aria-checked={noteFormat === format}
                    className={`segmented__opt${noteFormat === format ? " segmented__opt--active" : ""}`}
                    onClick={() => setNoteFormat(format)}
                  >
                    {NOTE_FORMAT_LABEL[format]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field field--full">
              <label className="row">
                <input
                  type="checkbox"
                  checked={recordVideo}
                  onChange={(e) => setRecordVideo(e.target.checked)}
                />
                Record video
              </label>
            </div>
          </div>

          {error ? <div className="banner banner--danger">{error}</div> : null}
        </div>

        <div className="dialog__foot">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy
              ? "Saving…"
              : calendarEvent?.visit
                ? "Save settings"
                : calendarEvent || scheduled
                  ? "Schedule bot"
                  : "Send bot"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
