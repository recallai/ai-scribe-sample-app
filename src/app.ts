import path from "path";
import { isAxiosError } from "axios";
import express from "express";
import { type AiClient, type ChatMessage, isNoteFormat, runScribe } from "./ai";
import { unrecordEvent } from "./calendar/events";
import { registerCalendarRoutes } from "./calendar/routes";
import type { Config } from "./config";
import type { Storage } from "./db";
import { botConfig, retryAfterCapacityError, type RecallApi, type RecallRecording } from "./recall";
import { newVisit } from "./visits";
import { registerWebhookRoute } from "./webhooks";

const LIVE_STATUSES = new Set(["joining", "in_call", "recording"]);

export function createApp(
  config: Config,
  recall: RecallApi,
  ai: AiClient,
  db: Storage,
) {
  const app = express();
  // Must come before express.json(): signature verification needs the raw body.
  registerWebhookRoute(app, { db, recall, ai, config });

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), "client", "dist")));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/config", (_req, res) => res.json({ noteFormat: config.noteFormat, recordVideo: config.recordVideo }));

  app.get("/visits", (_req, res) => res.json(db.listVisits()));

  app.get("/visits/:id", async (req, res) => {
    const visit = db.getVisit(req.params.id);
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    if (!visit.recordingId) return res.json(visit);
    // https://docs.recall.ai/reference/recording_retrieve
    const { data } = await recall.get<RecallRecording>(
      `/api/v1/recording/${visit.recordingId}/`,
    );
    const media = visit.recordVideo ? data.media_shortcuts?.video_mixed : data.media_shortcuts?.audio_mixed;
    res.json({ ...visit, recordingUrl: media?.data?.download_url ?? null });
  });

  app.post("/visits", async (req, res) => {
    const { meetingUrl, joinAt = null, recordVideo = config.recordVideo } = req.body ?? {};
    const patientName = typeof req.body?.patientName === "string" ? req.body.patientName.trim() : "";
    if (!meetingUrl || !patientName) {
      return res
        .status(400)
        .json({ error: "meetingUrl and patientName are required" });
    }
    if (typeof recordVideo !== "boolean") return res.status(400).json({ error: "recordVideo must be a boolean" });

    const noteFormat = req.body.noteFormat ?? config.noteFormat;
    if (!isNoteFormat(noteFormat)) {
      return res.status(400).json({ error: "noteFormat must be soap, dap, or birp" });
    }
    const existing = db.listVisits().find(
      (visit) =>
        (visit.status === "scheduled" || LIVE_STATUSES.has(visit.status)) &&
        visit.patientName === patientName &&
        visit.meetingUrl === meetingUrl &&
        visit.joinAt === joinAt,
    );
    if (existing) return res.json(existing);

    const visit = newVisit({
      patientName,
      meetingUrl,
      joinAt,
      noteFormat,
      recordVideo,
      keyTerms: Array.isArray(req.body.keyTerms) ? req.body.keyTerms : undefined,
    });
    db.saveVisit(visit);

    try {
      // https://docs.recall.ai/reference/bot_create
      const { data } = await retryAfterCapacityError(() =>
        recall.post<{ id: string }>("/api/v1/bot/", {
          meeting_url: visit.meetingUrl,
          ...(visit.joinAt ? { join_at: visit.joinAt } : {}),
          ...botConfig(visit, config),
        }),
      );
      visit.botId = data.id;
      visit.updatedAt = new Date().toISOString();
      db.saveVisit(visit);
      res.status(201).json(visit);
    } catch (error) {
      visit.status = "failed";
      visit.lastError = {
        event: "create_bot",
        subCode: error instanceof Error ? error.message : String(error),
      };
      db.saveVisit(visit);
      res.status(502).json(visit);
    }
  });

  // https://docs.recall.ai/docs/recording-control
  app.post("/visits/:id/pause", async (req, res) => {
    const visit = db.getVisit(req.params.id);
    if (!visit?.botId) return res.status(404).json({ error: "Visit or bot not found" });
    await recall.post(`/api/v1/bot/${visit.botId}/pause_recording/`);
    res.json(visit);
  });

  // https://docs.recall.ai/docs/recording-control
  app.post("/visits/:id/resume", async (req, res) => {
    const visit = db.getVisit(req.params.id);
    if (!visit?.botId) return res.status(404).json({ error: "Visit or bot not found" });
    await recall.post(`/api/v1/bot/${visit.botId}/resume_recording/`);
    res.json(visit);
  });

  // https://docs.recall.ai/docs/recording-control
  app.post("/visits/:id/leave", async (req, res) => {
    const visit = db.getVisit(req.params.id);
    if (!visit?.botId) return res.status(404).json({ error: "Visit or bot not found" });
    await recall.post(`/api/v1/bot/${visit.botId}/leave_call/`);
    res.json(visit);
  });

  app.delete("/visits/:id", async (req, res) => {
    const visit = db.getVisit(req.params.id);
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    if (visit.calendarEventId && visit.status === "scheduled") {
      return res.json(await unrecordEvent({ db, recall, config }, visit.calendarEventId));
    }
    // https://docs.recall.ai/reference/bot_destroy
    if (visit.botId && visit.status === "scheduled") {
      await recall.delete(`/api/v1/bot/${visit.botId}/`);
    }
    if (visit.botId && LIVE_STATUSES.has(visit.status)) {
      await recall.post(`/api/v1/bot/${visit.botId}/leave_call/`);
    }
    visit.status = "cancelled";
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);
    res.json(visit);
  });

  app.post("/visits/:id/note", async (req, res) => {
    const visit = db.getVisit(req.params.id);
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    if (!visit.transcript) {
      return res.status(409).json({ error: "Visit has no transcript yet" });
    }
    if (req.body?.format !== undefined) {
      if (!isNoteFormat(req.body.format)) {
        return res.status(400).json({ error: "format must be soap, dap, or birp" });
      }
      visit.noteFormat = req.body.format;
    }
    await runScribe(visit, ai);
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);
    res.json(visit);
  });

  app.post("/visits/:id/chat", async (req, res) => {
    const visit = db.getVisit(req.params.id);
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    if (!visit.transcript) {
      return res.status(409).json({ error: "Visit has no transcript yet" });
    }
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) return res.status(400).json({ error: "question is required" });

    const history: ChatMessage[] = Array.isArray(req.body?.history)
      ? req.body.history
          .filter(
            (m: unknown): m is ChatMessage =>
              !!m &&
              typeof m === "object" &&
              ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
              typeof (m as ChatMessage).content === "string",
          )
          .slice(-10)
      : [];

    const response = await ai.answer({
      question,
      history,
      transcript: visit.transcript,
      note: visit.note,
    });
    res.json(response);
  });

  registerCalendarRoutes(app, { config, db, recall });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      // Axios errors can contain credentials in their request config.
      if (isAxiosError(error)) {
        console.error(error.message);
        res.status(502).json({ error: error.message });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
