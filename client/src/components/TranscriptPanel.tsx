import type { TranscriptUtterance } from "../types";
import { Panel, PanelEmpty } from "./Panel";

function timestamp(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function TranscriptPanel({
  transcript,
  processing,
  onSeek,
}: {
  transcript: TranscriptUtterance[] | null;
  processing: boolean;
  onSeek: (seconds: number) => void;
}) {
  return (
    <Panel
      title="Transcript"
      chip={transcript ? <span className="chip">{transcript.length} turns</span> : null}
      flush
    >
      {!transcript ? (
        <PanelEmpty>
          {processing ? (
            <div className="row" role="status">
              <span className="spinner" aria-hidden="true" />
              Processing transcript…
            </div>
          ) : "The transcript is created after the visit ends."}
        </PanelEmpty>
      ) : transcript.length === 0 ? (
        <PanelEmpty>No speech was transcribed for this visit.</PanelEmpty>
      ) : (
        <div className="transcript">
          {transcript.map((line, index) => (
            <div className="bubble" key={index}>
              <span className="bubble__speaker">
                {line.speaker ?? "Unknown speaker"}
                {timestamp(line.startSeconds) ? (
                  <button
                    type="button"
                    className="timestamp-link"
                    onClick={() => {
                      if (typeof line.startSeconds === "number") onSeek(line.startSeconds);
                    }}
                  >
                    {timestamp(line.startSeconds)}
                  </button>
                ) : null}
              </span>
              <span className="bubble__text">{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
