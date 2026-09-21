// The client shares the server's domain types so the two can't drift.
import type {
  ClinicalNote,
  NoteFormat,
  TranscriptUtterance,
  Visit,
  VisitStatus,
} from "../../src/visits";

export type {
  ClinicalNote,
  NoteFormat,
  TranscriptUtterance,
  VisitStatus,
};

export type VisitView = Visit & { recordingUrl?: string | null };

export type ChatMessage = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// Calendar V2
// ---------------------------------------------------------------------------

export type CalendarProvider = {
  name: string;
  label: string;
  configured: boolean;
  connectUrl: string;
};

export type ConnectedCalendar = {
  id: string;
  platform: "google_calendar" | "microsoft_outlook";
  status: "connecting" | "connected" | "disconnected";
  platform_email: string | null;
  oauth_email?: string | null;
  created_at: string;
};

export type CalendarEventAttendee = {
  email: string;
  name: string | null;
  isOrganizer: boolean;
};

export type UpcomingEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  meetingUrl: string | null;
  attendees: CalendarEventAttendee[];
  /** The scheduled visit, if any. */
  visit: VisitView | null;
};

export type NewVisitInput = {
  meetingUrl: string;
  patientName: string;
  joinAt: string | null;
  keyTerms: string[];
  noteFormat: NoteFormat;
  recordVideo: boolean;
};
