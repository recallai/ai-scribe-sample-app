import { useRef } from "react";
import { formatDateTime, formatRelative, initials } from "../format";
import type { NoteFormat, VisitView } from "../types";
import { RecordingPanel } from "./RecordingPanel";
import { ChatPanel } from "./ChatPanel";
import { Icon } from "./Icon";
import { NotePanel } from "./NotePanel";
import { StatusBadge } from "./StatusBadge";
import { TranscriptPanel } from "./TranscriptPanel";

export type BotAction = "pause" | "resume" | "leave";

export function VisitDetail({
  visit,
  busy,
  onBot,
  onCancel,
  onRegenerate,
  onBack,
}: {
  visit: VisitView;
  busy: string | null;
  onBot: (action: BotAction) => Promise<void>;
  onCancel: () => Promise<void>;
  onRegenerate: (format: NoteFormat) => Promise<void>;
  onBack: () => void;
}) {
  const playerRef = useRef<HTMLMediaElement>(null);
  function seekRecording(seconds: number) {
    const player = playerRef.current;
    if (!player || !Number.isFinite(seconds)) return;
    player.currentTime = seconds;
    void player.play().catch(() => undefined);
    player.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const live = visit.status === "joining" || visit.status === "in_call" || visit.status === "recording";
  const terminal = visit.status === "failed" || visit.status === "cancelled";
  const canCancel = !terminal && visit.status !== "ready" && visit.status !== "processing";
  const paused = visit.botStatus === "in_call_not_recording";

  return (
    <div className="detail">
      <div className="detail__head">
        <button type="button" className="btn btn--ghost btn--icon only-mobile" onClick={onBack} aria-label="Back to visits">
          <Icon name="back" />
        </button>
        <span className="avatar avatar--lg">{initials(visit.title || visit.patientName)}</span>
        <div className="detail__title-block">
          <h1 className="detail__title">
            {visit.title || visit.patientName}
            <StatusBadge status={visit.status} />
          </h1>
          <div className="detail__subtitle">
            {visit.title && visit.patientName && <span>{visit.patientName}</span>}
            <span>
              {visit.joinAt
                ? `Scheduled ${formatDateTime(visit.joinAt)} · ${formatRelative(visit.joinAt)}`
                : `Ad-hoc · created ${formatRelative(visit.createdAt)}`}
            </span>
            <a href={visit.meetingUrl} target="_blank" rel="noreferrer">
              Meeting link
            </a>
          </div>
        </div>
        <div className="detail__actions">
          {live ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || paused}
                onClick={() => void onBot("pause")}
              >
                Pause
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || !paused}
                onClick={() => void onBot("resume")}
              >
                Resume
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy !== null}
                onClick={() => void onBot("leave")}
              >
                Remove
              </button>
            </>
          ) : null}
          {canCancel && !live ? (
            <button type="button" className="btn btn--danger" disabled={busy !== null} onClick={() => void onCancel()}>
              Cancel visit
            </button>
          ) : null}
        </div>
      </div>

      {visit.status === "failed" ? (
        <div className="banner banner--danger">
          <strong>This visit failed.</strong>
          <span>
            {visit.lastError
              ? `${visit.lastError.event}${visit.lastError.subCode ? ` — ${visit.lastError.subCode}` : ""}`
              : "No details available."}
          </span>
        </div>
      ) : visit.status === "cancelled" ? (
        <div className="banner banner--info">
          <strong>Cancelled.</strong> No note will be produced.
        </div>
      ) : null}

      {paused && live ? (
        <div className="banner banner--warn">
          <strong>Recording paused.</strong>
        </div>
      ) : null}

      <div className="detail__grid">
        <div className="detail__col">
          <NotePanel visit={visit} busy={busy === "note"} onRegenerate={onRegenerate} />
          {/* A failed or cancelled visit with no transcript has nothing more to show. */}
          {terminal && !visit.transcript ? null : (
            <>
              <TranscriptPanel
                transcript={visit.transcript}
                processing={visit.status === "processing"}
                onSeek={seekRecording}
              />
              <RecordingPanel recordingUrl={visit.recordingUrl} recordVideo={visit.recordVideo} playerRef={playerRef} />
            </>
          )}
        </div>

        <div className="detail__aside">
          <ChatPanel key={visit.id} visitId={visit.id} enabled={Boolean(visit.transcript)} onSeek={seekRecording} />
        </div>
      </div>
    </div>
  );
}
