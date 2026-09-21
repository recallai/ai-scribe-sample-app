import { randomUUID } from "crypto";
export type VisitStatus =
  | "scheduled"
  | "joining"
  | "in_call"
  | "recording"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

export type NoteFormat = "soap" | "dap" | "birp";

export type NoteSection = {
  heading: string;
  content: string;
};

export type ClinicalNote = {
  format: NoteFormat;
  sections: NoteSection[];
  model: string;
  generatedAt: string;
};

export type TranscriptUtterance = {
  speaker: string | null;
  isHost: boolean | null;
  text: string;
  /** Seconds from the start of the recording, retained for playback links. */
  startSeconds?: number | null;
  endSeconds?: number | null;
};

export type Visit = {
  id: string;
  meetingUrl: string;
  joinAt: string | null;
  patientName: string;
  title?: string;
  keyTerms: string[];
  noteFormat: NoteFormat;
  recordVideo: boolean;
  /** Set when the visit came from a connected calendar, so repeated syncs of
   * the same event update this visit instead of creating another — and so a
   * disconnected calendar can fail its pending visits. */
  calendarId: string | null;
  calendarEventId: string | null;
  botId: string | null;
  botStatus: string | null;
  lastBotEventAt: string | null;
  recordingId: string | null;
  transcriptId: string | null;
  transcriptRequested: boolean;
  status: VisitStatus;
  lastError: { event: string; subCode: string | null } | null;
  transcript: TranscriptUtterance[] | null;
  note: ClinicalNote | null;
  aiError: { stage: "note"; message: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** Example medical vocabulary the transcription is biased toward when a visit doesn't supply its own. */
export const DEFAULT_KEY_TERMS = [
  "lisinopril",
  "metformin",
  "atorvastatin",
  "semaglutide",
  "amoxicillin-clavulanate",
  "echocardiogram",
  "spirometry",
];

export function newVisit(args: {
  patientName: string;
  meetingUrl: string;
  joinAt: string | null;
  noteFormat: NoteFormat;
  recordVideo: boolean;
  keyTerms?: string[];
  calendarId?: string | null;
  calendarEventId?: string | null;
}): Visit {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    meetingUrl: args.meetingUrl,
    joinAt: args.joinAt,
    patientName: args.patientName,
    keyTerms: args.keyTerms?.length ? args.keyTerms : DEFAULT_KEY_TERMS,
    noteFormat: args.noteFormat,
    recordVideo: args.recordVideo,
    calendarId: args.calendarId ?? null,
    calendarEventId: args.calendarEventId ?? null,
    botId: null,
    botStatus: null,
    lastBotEventAt: null,
    recordingId: null,
    transcriptId: null,
    transcriptRequested: false,
    status: "scheduled",
    lastError: null,
    transcript: null,
    note: null,
    aiError: null,
    createdAt: now,
    updatedAt: now,
  };
}
