import type { RefObject } from "react";
import { Panel, PanelEmpty } from "./Panel";

export function RecordingPanel({ recordingUrl, recordVideo, playerRef }: {
  recordingUrl?: string | null;
  recordVideo: boolean;
  playerRef: RefObject<HTMLMediaElement | null>;
}) {
  return (
    <Panel title="Recording">
      {!recordingUrl ? (
        <PanelEmpty>Available after Recall finishes processing the visit.</PanelEmpty>
      ) : recordVideo ? (
        <video className="recording" ref={(element) => { playerRef.current = element; }} controls preload="none" src={recordingUrl} />
      ) : (
        <audio style={{ width: "100%" }} ref={(element) => { playerRef.current = element; }} controls preload="none" src={recordingUrl} />
      )}
    </Panel>
  );
}
