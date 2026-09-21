import type { Config } from "../config";
import type { Storage } from "../db";
import { botConfig, listAll, retryAfterCapacityError, type RecallApi } from "../recall";
import { newVisit, type NoteFormat, type Visit } from "../visits";
import { type Calendar, type CalendarEvent, deduplicationKey, eventTitle } from "./model";

export type CalendarDeps = {
  db: Storage;
  recall: RecallApi;
  config: Config;
};

export type RecallCalendarWebhook = {
  event: "calendar.sync_events" | "calendar.update";
  data: { calendar_id: string; last_updated_ts?: string };
};

export async function recordEvent(
  deps: CalendarDeps,
  event: CalendarEvent,
  args: { patientName: string; noteFormat: NoteFormat; recordVideo: boolean; keyTerms?: string[] },
): Promise<Visit> {
  if (!event.meeting_url) throw new Error("Calendar event has no meeting URL");

  const visit =
    deps.db.getVisitByCalendarEventId(event.id) ??
    newVisit({
      patientName: args.patientName,
      meetingUrl: event.meeting_url,
      joinAt: event.start_time,
      noteFormat: args.noteFormat,
      recordVideo: args.recordVideo,
      keyTerms: args.keyTerms,
      calendarId: event.calendar_id,
      calendarEventId: event.id,
    });

  visit.patientName = args.patientName;
  visit.title = eventTitle(event);
  visit.noteFormat = args.noteFormat;
  visit.recordVideo = args.recordVideo;
  if (args.keyTerms) visit.keyTerms = args.keyTerms;

  // https://docs.recall.ai/reference/calendar_events_bot_create
  const { data: updated } = await retryAfterCapacityError(() =>
    deps.recall.post<CalendarEvent>(`/api/v2/calendar-events/${event.id}/bot/`, {
      deduplication_key: deduplicationKey(event),
      bot_config: botConfig(visit, deps.config),
    }),
  );

  // Keep the previous schedule until Recall accepts the new one.
  visit.meetingUrl = event.meeting_url;
  visit.joinAt = event.start_time;
  visit.status = "scheduled";
  visit.lastError = null;
  visit.botId = updated.bots[0]?.bot_id ?? visit.botId;
  visit.updatedAt = new Date().toISOString();
  deps.db.saveVisit(visit);
  return visit;
}

export async function unrecordEvent(
  deps: CalendarDeps,
  eventId: string,
): Promise<Visit | undefined> {
  // https://docs.recall.ai/reference/calendar_events_bot_destroy
  await deps.recall.delete(`/api/v2/calendar-events/${eventId}/bot/`);
  const visit = deps.db.getVisitByCalendarEventId(eventId);
  return visit ? cancelVisit(deps.db, visit) : undefined;
}

export async function handleCalendarWebhook(
  deps: CalendarDeps,
  event: RecallCalendarWebhook,
): Promise<void> {
  if (event.event === "calendar.sync_events") {
    await syncCalendarEvents(deps, event.data.calendar_id, event.data.last_updated_ts);
    return;
  }

  // https://docs.recall.ai/reference/calendars_retrieve
  const { data: calendar } = await deps.recall.get<Calendar>(
    `/api/v2/calendars/${event.data.calendar_id}/`,
  );
  if (calendar.status === "disconnected") {
    const failed = failVisitsForCalendar(deps.db, calendar.id);
    console.warn("calendar disconnected", {
      calendarId: calendar.id,
      since: calendar.status_changes.at(-1)?.created_at,
      visitsFailed: failed,
    });
  }
}

/**
 * Reconcile visits this app scheduled after a `calendar.sync_events` webhook.
 * Events nobody opted into are left alone. A moved event is rescheduled by
 * calling Schedule Bot again; Recall replaces the previous bot.
 * https://docs.recall.ai/docs/scheduling-guide
 */
export async function syncCalendarEvents(
  deps: CalendarDeps,
  calendarId: string,
  since?: string,
): Promise<void> {
  // https://docs.recall.ai/reference/calendar_events_list
  const events = await listAll<CalendarEvent>(deps.recall, "/api/v2/calendar-events/", {
    calendar_id: calendarId,
    updated_at__gte: since,
  });

  for (const event of events) {
    const visit = deps.db.getVisitByCalendarEventId(event.id);

    try {
      if (!visit || visit.status !== "scheduled") continue;
      if (event.is_deleted) {
        cancelVisit(deps.db, visit);
        console.log("calendar event deleted; visit cancelled", { visitId: visit.id });
        continue;
      }

      if (!event.meeting_url) {
        await unrecordEvent(deps, event.id);
        console.log("calendar event lost its meeting URL; visit cancelled", { visitId: visit.id });
        continue;
      }

      const moved =
        visit.joinAt !== event.start_time || visit.meetingUrl !== event.meeting_url;
      if (!moved) continue;

      await recordEvent(deps, event, {
        patientName: visit.patientName,
        noteFormat: visit.noteFormat,
        recordVideo: visit.recordVideo,
        keyTerms: visit.keyTerms,
      });
      console.log("calendar event moved; bot rescheduled", {
        visitId: visit.id,
        joinAt: event.start_time,
      });
    } catch (error) {
      console.error("calendar sync failed for event", {
        eventId: event.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function failVisitsForCalendar(db: Storage, calendarId: string): number {
  let count = 0;
  for (const visit of db.listVisits()) {
    if (visit.calendarId !== calendarId || visit.status !== "scheduled") continue;
    visit.status = "failed";
    visit.lastError = { event: "calendar.update", subCode: "calendar_disconnected" };
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);
    count += 1;
  }
  return count;
}

function cancelVisit(db: Storage, visit: Visit): Visit {
  visit.status = "cancelled";
  visit.updatedAt = new Date().toISOString();
  db.saveVisit(visit);
  return visit;
}
