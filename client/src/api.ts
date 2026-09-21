import type {
  CalendarProvider,
  ChatMessage,
  ConnectedCalendar,
  NewVisitInput,
  NoteFormat,
  UpcomingEvent,
  VisitView,
} from "./types";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with status ${status}`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export const api = {
  config: () => request<{ noteFormat: NoteFormat; recordVideo: boolean }>("/config"),

  listVisits: () => request<VisitView[]>("/visits"),
  getVisit: (id: string) => request<VisitView>(`/visits/${id}`),
  createVisit: (input: NewVisitInput) =>
    request<VisitView>("/visits", { method: "POST", body: JSON.stringify(input) }),
  botAction: (id: string, action: "pause" | "resume" | "leave") =>
    request<VisitView>(`/visits/${id}/${action}`, { method: "POST" }),
  cancelVisit: (id: string) => request<VisitView>(`/visits/${id}`, { method: "DELETE" }),

  regenerateNote: (id: string, format?: NoteFormat) =>
    request<VisitView>(`/visits/${id}/note`, {
      method: "POST",
      body: JSON.stringify(format ? { format } : {}),
    }),
  chat: (id: string, question: string, history: ChatMessage[]) =>
    request<{ answer: string; timestamps: number[] }>(`/visits/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, history }),
    }),

  // Provider availability is returned even when no OAuth client is configured.
  calendarProviders: () =>
    request<{ providers: CalendarProvider[] }>("/calendar/providers"),
  listCalendars: () => request<{ calendars: ConnectedCalendar[] }>("/calendars"),
  disconnectCalendar: (id: string) =>
    request<void>(`/calendars/${id}`, { method: "DELETE" }),
  listCalendarEvents: (id: string) =>
    request<{ events: UpcomingEvent[] }>(`/calendars/${id}/events`),
  recordEvent: (eventId: string, input: Omit<NewVisitInput, "meetingUrl" | "joinAt" | "patientName"> & { patientName?: string }) =>
    request<VisitView>(`/calendar-events/${eventId}/record`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unrecordEvent: (eventId: string) =>
    request<unknown>(`/calendar-events/${eventId}/record`, { method: "DELETE" }),
};
