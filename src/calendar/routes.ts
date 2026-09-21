import { randomBytes } from "crypto";
import express from "express";
import { isNoteFormat } from "../ai";
import { type Config, calendarProviderReady, enabledCalendarProviders } from "../config";
import type { Storage } from "../db";
import { listAll, type RecallApi } from "../recall";
import { failVisitsForCalendar, recordEvent, unrecordEvent } from "./events";
import { type Calendar, type CalendarEvent, eventAttendees, eventTitle } from "./model";
import * as oauth from "./oauth";
import { PROVIDERS, PROVIDER_NAMES, type ProviderName, isProviderName } from "./oauth";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function registerCalendarRoutes(
  app: express.Express,
  { config, db, recall }: { config: Config; db: Storage; recall: RecallApi },
) {
  const redirectUri = (provider: ProviderName) =>
    `${config.publicUrl}/calendar/callback/${provider}`;
  // Calendar V2 needs an OAuth client of your own, so without one there is
  // nothing to connect and these routes have nothing to act on.
  const configured = () => enabledCalendarProviders(config).length > 0;
  const requireCalendar = (res: express.Response): boolean => {
    if (!configured()) {
      res.status(503).json({ error: "No calendar provider is configured" });
      return false;
    }
    return true;
  };
  const pendingOAuth = new Map<string, { calendarId?: string; expires: number }>();

  app.get("/calendar/providers", (_req, res) => {
    res.json({
      providers: PROVIDER_NAMES.map((provider) => ({
        name: provider,
        label: PROVIDERS[provider].label,
        configured: enabledCalendarProviders(config).includes(provider),
        connectUrl: `/calendar/connect/${provider}`,
      })),
    });
  });

  app.get("/calendar/connect/:provider", (req, res) => {
    const provider = req.params.provider;
    if (!isProviderName(provider) || !calendarProviderReady(config, provider)) {
      return res.status(400).send("That calendar provider isn't configured. See the README.");
    }

    const state = randomBytes(24).toString("base64url");
    pendingOAuth.set(state, {
      calendarId: typeof req.query.calendar === "string" ? req.query.calendar : undefined,
      expires: Date.now() + OAUTH_STATE_TTL_MS,
    });
    for (const [key, entry] of pendingOAuth) {
      if (entry.expires < Date.now()) pendingOAuth.delete(key);
    }
    res.redirect(
      oauth.buildAuthorizeUrl(provider, {
        clientId: config.oauthClients[provider].clientId,
        redirectUri: redirectUri(provider),
        state,
      }),
    );
  });

  app.get("/calendar/callback/:provider", async (req, res) => {
    const provider = req.params.provider;
    if (!isProviderName(provider) || !calendarProviderReady(config, provider)) {
      return res.status(400).send("That calendar provider isn't configured.");
    }
    const back = (params: Record<string, string>) =>
      res.redirect(`/?${new URLSearchParams({ view: "calendar", ...params })}`);
    if (typeof req.query.error === "string") return back({ calendarError: req.query.error });

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return back({ calendarError: "missing_authorization_code" });
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const pending = pendingOAuth.get(state);
    pendingOAuth.delete(state);
    if (!pending || pending.expires < Date.now()) {
      return back({ calendarError: "This sign-in link has expired. Please connect again." });
    }

    try {
      const credentials = config.oauthClients[provider];
      const tokens = await oauth.exchangeCode(provider, { code, credentials, redirectUri: redirectUri(provider) });
      if (!tokens.refresh_token) throw new Error("No refresh token was returned by the provider.");

      // Reconnecting an existing calendar updates it in place rather than
      // creating a second one for the same account.
      let calendarId = pending.calendarId ?? "";
      if (!calendarId) {
        const email = await oauth.fetchAccountEmail(provider, tokens.access_token);
        if (email) {
          const matches = await listAll<Calendar>(recall, "/api/v2/calendars/", {
            email,
            platform: PROVIDERS[provider].platform,
          });
          calendarId = matches[0]?.id ?? "";
        }
      }

      const body = {
        platform: PROVIDERS[provider].platform,
        oauth_client_id: credentials.clientId,
        oauth_refresh_token: tokens.refresh_token,
        ...(oauth.usesCertificate(provider, credentials)
          ? {
              oauth_client_certificate: credentials.certificate,
              oauth_client_private_key: credentials.privateKey,
            }
          : { oauth_client_secret: credentials.clientSecret }),
      };

      // https://docs.recall.ai/reference/calendars_create
      const { data: connected } = calendarId
        ? await recall.patch<Calendar>(`/api/v2/calendars/${calendarId}/`, body)
        : await recall.post<Calendar>("/api/v2/calendars/", body);
      back({ calendar: connected.id });
    } catch (error) {
      console.error("calendar connection failed", error instanceof Error ? error.message : String(error));
      back({ calendarError: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/calendars", async (_req, res) => {
    if (!requireCalendar(res)) return;
    // https://docs.recall.ai/reference/calendars_list
    const calendars = await listAll<Calendar>(recall, "/api/v2/calendars/");
    res.json({ calendars: calendars.filter((calendar) => calendar.status === "connected") });
  });

  app.delete("/calendars/:id", async (req, res) => {
    if (!requireCalendar(res)) return;
    // Deleting a calendar unschedules every future bot on it.
    // https://docs.recall.ai/reference/calendars_destroy
    await recall.delete(`/api/v2/calendars/${req.params.id}/`);
    // Recall does not send a calendar.update webhook for this deletion.
    failVisitsForCalendar(db, req.params.id);
    res.sendStatus(204);
  });

  app.get("/calendars/:id/events", async (req, res) => {
    if (!requireCalendar(res)) return;
    // Recall only syncs events up to 28 days ahead.
    const events = await listAll<CalendarEvent>(recall, "/api/v2/calendar-events/", {
      calendar_id: req.params.id,
      is_deleted: false,
      start_time__gte: new Date().toISOString(),
    });
    res.json({
      events: events
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .map((event) => {
          const visit = db.getVisitByCalendarEventId(event.id);
          return {
            id: event.id,
            title: eventTitle(event),
            startTime: event.start_time,
            endTime: event.end_time,
            meetingUrl: event.meeting_url,
            attendees: eventAttendees(event),
            visit: visit && visit.status !== "cancelled" ? visit : null,
          };
        }),
    });
  });

  app.post("/calendar-events/:id/record", async (req, res) => {
    if (!requireCalendar(res)) return;
    const patientName = typeof req.body?.patientName === "string" ? req.body.patientName.trim() : "";
    const recordVideo = req.body?.recordVideo ?? config.recordVideo;
    if (typeof recordVideo !== "boolean") return res.status(400).json({ error: "recordVideo must be a boolean" });
    const existing = db.getVisitByCalendarEventId(req.params.id);
    if (existing && existing.status !== "scheduled" && existing.status !== "cancelled") {
      return res.status(409).json({ error: "Only scheduled visits can be configured" });
    }
    const noteFormat = req.body?.noteFormat ?? config.noteFormat;
    if (!isNoteFormat(noteFormat)) {
      return res.status(400).json({ error: "noteFormat must be soap, dap, or birp" });
    }

    // https://docs.recall.ai/reference/calendar_events_retrieve
    const { data: event } = await recall.get<CalendarEvent>(
      `/api/v2/calendar-events/${req.params.id}/`,
    );
    const visit = await recordEvent({ db, recall, config }, event, {
      patientName,
      recordVideo,
      keyTerms: Array.isArray(req.body?.keyTerms) ? req.body.keyTerms : undefined,
      noteFormat,
    });
    res.status(201).json(visit);
  });

  app.delete("/calendar-events/:id/record", async (req, res) => {
    if (!requireCalendar(res)) return;
    const visit = await unrecordEvent({ db, recall, config }, req.params.id);
    res.json(visit ?? { ok: true });
  });
}
