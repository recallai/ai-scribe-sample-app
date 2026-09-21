import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { NOTE_FORMAT_LABEL, formatDateTime, formatRelative } from "../format";
import type {
  CalendarProvider,
  ConnectedCalendar,
  NoteFormat,
  NewVisitInput,
  UpcomingEvent,
} from "../types";
import { Icon } from "./Icon";
import { Panel, PanelEmpty } from "./Panel";
import { StatusBadge } from "./StatusBadge";
import { NewVisitDialog } from "./NewVisitDialog";

const PLATFORM_LABEL: Record<ConnectedCalendar["platform"], string> = {
  google_calendar: "Google Calendar",
  microsoft_outlook: "Microsoft Outlook",
};

function calendarEmail(calendar: ConnectedCalendar): string {
  return calendar.platform_email ?? calendar.oauth_email ?? "Syncing…";
}

export function CalendarView({
  defaultFormat,
  defaultRecordVideo,
  onOpenVisit,
  onError,
}: {
  defaultFormat: NoteFormat;
  defaultRecordVideo: boolean;
  onOpenVisit: (visitId: string) => void;
  onError: (message: string) => void;
}) {
  const [providers, setProviders] = useState<CalendarProvider[]>([]);
  const [calendars, setCalendars] = useState<ConnectedCalendar[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<UpcomingEvent | null>(null);
  const [noteFormat, setNoteFormat] = useState(defaultFormat);
  const [recordVideo, setRecordVideo] = useState(defaultRecordVideo);
  const [keyTerms, setKeyTerms] = useState("");

  useEffect(() => { setNoteFormat(defaultFormat); }, [defaultFormat]);
  useEffect(() => { setRecordVideo(defaultRecordVideo); }, [defaultRecordVideo]);

  const loadCalendars = useCallback(async () => {
    // Loaded independently: which providers are configured is local, but
    // listing connected calendars needs Recall. If that call fails, the
    // Connect buttons still have to be there to fix it with.
    try {
      setProviders((await api.calendarProviders()).providers ?? []);
    } catch {
      setProviders([]);
    }

    try {
      const { calendars = [] } = await api.listCalendars();
      setCalendars(calendars);
      setConfigured(true);
      setSelectedId((current) =>
        calendars.some((calendar) => calendar.id === current) ? current : calendars[0]?.id ?? null,
      );
    } catch (error) {
      // 503 just means no provider is configured, which is a normal state.
      if (error instanceof ApiError && error.status === 503) {
        setConfigured(false);
        return;
      }
      setConfigured(true);
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [onError]);

  useEffect(() => {
    void loadCalendars();
  }, [loadCalendars]);

  const loadEvents = useCallback(async () => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    setLoadingEvents(true);
    try {
      setEvents((await api.listCalendarEvents(selectedId)).events ?? []);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingEvents(false);
    }
  }, [selectedId, onError]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function saveSettings(input: NewVisitInput) {
    if (!editingEvent) return;
    const { meetingUrl, joinAt, ...settings } = input;
    await api.recordEvent(editingEvent.id, settings);
    setEditingEvent(null);
    await loadEvents();
  }

  async function record(event: UpcomingEvent) {
    setBusyId(event.id);
    try {
      const visit = await api.recordEvent(event.id, {
        noteFormat,
        recordVideo,
        keyTerms: keyTerms.split(",").map((term) => term.trim()).filter(Boolean),
      });
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, visit } : item));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function stopRecording(event: UpcomingEvent) {
    setBusyId(event.id);
    try {
      await api.unrecordEvent(event.id);
      await loadEvents();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(calendar: ConnectedCalendar) {
    setBusyId(calendar.id);
    try {
      await api.disconnectCalendar(calendar.id);
      setSelectedId(null);
      await loadCalendars();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  if (configured === false && providers.length === 0) {
    return (
      <div className="calendar">
        <div className="stack" style={{ gridColumn: "1 / -1" }}>
          <Panel title="Calendar">
            <PanelEmpty>
              <Icon name="sparkle" size={22} />
              <span>
                No calendar provider is configured. Set <code className="mono">PUBLIC_URL</code>{" "}
                and a Google or Outlook OAuth client in <code className="mono">.env</code> to
                schedule bots straight from a clinician's calendar — see the README.
              </span>
            </PanelEmpty>
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="calendar">
      <div className="stack">
        <Panel
          title="Connected calendars"
          chip={<span className="chip">{calendars.length}</span>}
          flush
        >
          {calendars.length === 0 ? (
            <PanelEmpty>Nothing connected yet.</PanelEmpty>
          ) : (
            <ul className="sidebar__list" style={{ padding: "6px 8px" }}>
              {calendars.map((calendar) => (
                <li key={calendar.id}>
                  <button
                    type="button"
                    className={`calendar-item${calendar.id === selectedId ? " calendar-item--active" : ""}`}
                    onClick={() => setSelectedId(calendar.id)}
                  >
                    <span className="avatar">
                      {calendar.platform === "google_calendar" ? "G" : "O"}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <div className="calendar-item__name">{calendarEmail(calendar)}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {PLATFORM_LABEL[calendar.platform]}
                      </div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {providers.map((provider) => (
                provider.configured ? (
                  <a className="btn btn--sm" key={provider.name} href={provider.connectUrl}>
                    <Icon name="plus" size={14} />
                    Connect {provider.label}
                  </a>
                ) : (
                  <span className="tooltip" key={provider.name}>
                    <button type="button" className="btn btn--sm" disabled>
                      <Icon name="plus" size={14} />
                      Connect {provider.label}
                    </button>
                    <span className="tooltip__content" role="tooltip">
                      {provider.label} OAuth client has not been configured. Check the README for instructions on how to set this up!
                    </span>
                  </span>
                )
              ))}
            </div>
          </div>
        </Panel>

      </div>

      <div className="stack">
        {selectedId && (
          <Panel title="Recording settings">
            <div className="row" style={{ flexWrap: "wrap" }}>
              <label className="row">
                Note format
                <select className="select select--inline" value={noteFormat}
                  onChange={(e) => setNoteFormat(e.target.value as NoteFormat)}>
                  {Object.entries(NOTE_FORMAT_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="row">
                <input type="checkbox" checked={recordVideo} onChange={(e) => setRecordVideo(e.target.checked)} />
                Record video
              </label>
            </div>
            <details style={{ marginTop: 12 }}>
              <summary>Key terms (optional)</summary>
              <input className="input" aria-label="Key terms" placeholder="Comma-separated terms"
                value={keyTerms} onChange={(e) => setKeyTerms(e.target.value)} style={{ marginTop: 8 }} />
            </details>
            <p className="muted" style={{ marginTop: 12 }}>Applied when scheduling. Scheduled visits keep their settings.</p>
          </Panel>
        )}
        <Panel
          title="Upcoming events"
          chip={loadingEvents ? <span className="spinner" /> : null}
          actions={
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadEvents()}>
                <Icon name="refresh" size={14} />
                Refresh
              </button>
              {selectedId ? (
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  disabled={busyId !== null}
                  onClick={() => {
                    const calendar = calendars.find((entry) => entry.id === selectedId);
                    if (calendar) void disconnect(calendar);
                  }}
                >
                  Disconnect
                </button>
              ) : null}
            </>
          }
          flush
        >
          {!selectedId ? (
            <PanelEmpty>Connect a calendar to see upcoming visits.</PanelEmpty>
          ) : events.length === 0 ? (
            <PanelEmpty>
              No upcoming events with a meeting link. Recall syncs events up to 28 days ahead.
            </PanelEmpty>
          ) : (
            <div style={{ padding: "8px 0" }}>
              {events.map((event, index) => {
                const recording = Boolean(event.visit);
                const guests = event.attendees.filter((attendee) => !attendee.isOrganizer);
                return (
                  <div
                    key={event.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "12px 16px",
                      borderTop: index > 0 ? "1px solid var(--border)" : undefined,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <strong>{event.title}</strong>
                        {event.visit ? <StatusBadge status={event.visit.status} /> : null}
                      </div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        {formatDateTime(event.startTime)} · {formatRelative(event.startTime)}
                      </div>
                      {guests.length ? (
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {guests.map((attendee) => attendee.email).join(", ")}
                        </div>
                      ) : null}
                      {!event.meetingUrl ? (
                        <div className="chip" style={{ marginTop: 6 }}>
                          No meeting link
                        </div>
                      ) : null}
                    </div>

                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {recording ? (
                        <>
                          {event.visit?.status === "scheduled" && <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => setEditingEvent(event)}
                          >
                            Settings
                          </button>}
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => onOpenVisit(event.visit!.id)}
                          >
                            Open visit
                          </button>
                          {event.visit?.status === "scheduled" && <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={busyId !== null}
                            onClick={() => void stopRecording(event)}
                          >
                            Cancel
                          </button>}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={
                              busyId !== null ||
                              !event.meetingUrl
                            }
                            onClick={() => void record(event)}
                          >
                            {busyId === event.id ? <span className="spinner" /> : null}
                            Schedule AI Scribe
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
      <NewVisitDialog
        open={editingEvent !== null}
        calendarEvent={editingEvent ?? undefined}
        defaultFormat={defaultFormat}
        defaultRecordVideo={defaultRecordVideo}
        onClose={() => setEditingEvent(null)}
        onSubmit={saveSettings}
      />
    </div>
  );
}
