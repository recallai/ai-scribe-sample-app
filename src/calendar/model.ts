// Calendar V2 wire shapes, plus helpers for reading an event's `raw` payload —
// whatever the calendar provider returned.
// https://docs.recall.ai/docs/calendar-event-platform-data

export type CalendarPlatform = "google_calendar" | "microsoft_outlook";
export type CalendarStatus = "connecting" | "connected" | "disconnected";
export type Calendar = {
  id: string;
  platform: CalendarPlatform;
  status: CalendarStatus;
  platform_email: string | null;
  oauth_email?: string | null;
  oauth_client_id: string;
  status_changes: Array<{ status: CalendarStatus; created_at: string }>;
  metadata?: Record<string, string>;
  created_at: string;
  updated_at: string;
};
export type CalendarEventBot = {
  bot_id: string;
  start_time?: string;
  meeting_url?: string;
  deduplication_key?: string;
};
export type CalendarEvent = {
  id: string;
  calendar_id: string;
  start_time: string;
  end_time: string;
  meeting_url: string | null;
  platform: CalendarPlatform;
  platform_id: string;
  ical_uid: string;
  is_deleted: boolean;
  bots: CalendarEventBot[];
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};


export type EventAttendee = { email: string; name: string | null; isOrganizer: boolean };

export function eventAttendees(event: CalendarEvent): EventAttendee[] {
  const raw = event.raw as Record<string, any>;
  const attendees: EventAttendee[] = [];

  if (event.platform === "google_calendar") {
    for (const attendee of raw?.attendees ?? []) {
      if (!attendee?.email) continue;
      attendees.push({
        email: String(attendee.email).toLowerCase(),
        name: attendee.displayName ?? null,
        isOrganizer: Boolean(attendee.organizer || attendee.self),
      });
    }
  } else {
    const organizerEmail = String(
      raw?.organizer?.emailAddress?.address ?? "",
    ).toLowerCase();
    for (const attendee of raw?.attendees ?? []) {
      const email = attendee?.emailAddress?.address;
      if (!email) continue;
      attendees.push({
        email: String(email).toLowerCase(),
        name: attendee.emailAddress?.name ?? null,
        isOrganizer: String(email).toLowerCase() === organizerEmail,
      });
    }
  }

  return attendees;
}

export function eventTitle(event: CalendarEvent): string {
  const raw = event.raw as Record<string, any>;
  const title = event.platform === "google_calendar" ? raw?.summary : raw?.subject;
  return typeof title === "string" && title.trim() ? title.trim() : "Untitled event";
}

/**
 * "Deduplicate all": one bot per meeting across every connected calendar.
 * https://docs.recall.ai/docs/scheduling-guide#4-deduplicating-bots-custom-bot-deduplication-key
 */
export function deduplicationKey(event: CalendarEvent): string {
  return `${event.start_time}-${event.meeting_url ?? ""}`;
}
