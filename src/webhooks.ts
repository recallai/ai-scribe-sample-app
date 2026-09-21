import crypto from "crypto";
import axios from "axios";
import express from "express";
import { type AiClient, runScribe } from "./ai";
import type { Config } from "./config";
import { handleCalendarWebhook, type RecallCalendarWebhook } from "./calendar/events";
import type { Storage } from "./db";
import type { RecallApi, RecallArtifact } from "./recall";
import type { TranscriptUtterance, Visit, VisitStatus } from "./visits";

export type WebhookDeps = {
  db: Storage;
  recall: RecallApi;
  ai: AiClient;
  config: Config;
};

const BOT_STATUS: Record<string, VisitStatus> = {
  "bot.joining_call": "joining",
  "bot.in_waiting_room": "joining",
  "bot.in_call_not_recording": "in_call",
  "bot.in_call_recording": "recording",
  "bot.call_ended": "processing",
  "bot.done": "processing",
};

const FAILURE_EVENTS = new Set([
  "bot.fatal",
  "bot.recording_permission_denied",
  "recording.failed",
  "transcript.failed",
]);

export function registerWebhookRoute(app: express.Express, services: WebhookDeps): void {
  app.post(
    "/webhooks/recall",
    express.raw({ type: "application/json" }),
    (req, res) => {
      const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      try {
        verifyRequestFromRecall({
          secret: services.config.recallWebhookSecret,
          headers: req.headers,
          payload: payload.toString("utf8"),
        });
      } catch {
        res.status(400).send("Invalid webhook signature");
        return;
      }

      let event: RecallEvent;
      try {
        event = JSON.parse(payload.toString("utf8")) as RecallEvent;
      } catch {
        res.status(400).send("Invalid JSON");
        return;
      }

      res.sendStatus(204);
      setImmediate(() => void handleWebhook(services, event));
    },
  );
}

export async function handleWebhook(deps: WebhookDeps, event: RecallEvent): Promise<void> {
  if (isCalendarEvent(event)) {
    try {
      await handleCalendarWebhook(deps, event);
    } catch (error) {
      console.error("calendar webhook failed", {
        event: event.event,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const visit = findVisit(deps.db, event);
  if (!visit) {
    console.warn("webhook for an unknown visit", { event: event.event });
    return;
  }

  try {
    await processEvent(deps, visit, event);
  } catch (error) {
    visit.status = "failed";
    visit.lastError = {
      event: event.event,
      subCode: error instanceof Error ? error.message : String(error),
    };
    console.error("webhook processing failed", { visitId: visit.id, ...visit.lastError });
    visit.updatedAt = new Date().toISOString();
    deps.db.saveVisit(visit);
  }
}

async function processEvent(
  deps: WebhookDeps,
  visit: Visit,
  event: RecallWebhook,
): Promise<void> {
  const { db, recall, ai } = deps;
  if (event.data.bot?.id) visit.botId ??= event.data.bot.id;

  if (FAILURE_EVENTS.has(event.event)) {
    visit.status = "failed";
    visit.lastError = { event: event.event, subCode: event.data.data?.sub_code ?? null };
    console.error("visit failed", { visitId: visit.id, ...visit.lastError });
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);
    return;
  }

  if (event.event.startsWith("bot.")) {
    // Webhooks can arrive out of order or be retried. Skip stale bot events, and
    // don't let a late one move a visit back once its recording is processing.
    const eventAt = event.data.data?.updated_at;
    if (eventAt && visit.lastBotEventAt && eventAt <= visit.lastBotEventAt) return;
    if (eventAt) visit.lastBotEventAt = eventAt;
    visit.botStatus = event.event.slice("bot.".length);

    const pipelineStarted =
      Boolean(visit.recordingId || visit.transcriptRequested || visit.transcriptId) ||
      visit.status === "ready";
    if (!pipelineStarted && BOT_STATUS[event.event]) {
      visit.status = BOT_STATUS[event.event];
    }
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);
    return;
  }

  if (event.event === "recording.done") {
    if (visit.transcriptRequested) return;
    visit.recordingId ??= event.data.recording?.id ?? null;
    if (!visit.recordingId) throw new Error("recording.done had no recording ID");
    visit.status = "processing";

    // Save before the paid API call to prevent duplicate transcription requests.
    visit.transcriptRequested = true;
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);
    try {
      // https://docs.recall.ai/reference/recording_create_transcript_create
      const { data } = await recall.post<{ id: string }>(
        `/api/v1/recording/${visit.recordingId}/create_transcript/`,
        {
          metadata: { visitId: visit.id },
          provider: {
            recallai_async: { language_code: "auto", key_terms: visit.keyTerms },
          },
          diarization: { use_separate_streams_when_available: true },
        },
      );
      visit.transcriptId = data.id;
      visit.updatedAt = new Date().toISOString();
      db.saveVisit(visit);
    } catch (error) {
      visit.transcriptRequested = false;
      throw error;
    }
    return;
  }

  if (event.event === "transcript.done") {
    if (visit.transcript !== null) return;
    visit.recordingId ??= event.data.recording?.id ?? null;
    visit.transcriptId ??= event.data.transcript?.id ?? null;
    if (!visit.transcriptId) throw new Error("transcript.done had no transcript ID");

    // https://docs.recall.ai/reference/transcript_retrieve
    const { data: artifact } = await recall.get<RecallArtifact>(
      `/api/v1/transcript/${visit.transcriptId}/`,
    );
    const transcriptUrl = artifact.data?.download_url;
    if (!transcriptUrl) throw new Error("Transcript download URL is missing");

    // https://docs.recall.ai/docs/download-urls
    const { data: downloaded } = await axios.get(transcriptUrl);
    visit.transcript = toTranscript(Array.isArray(downloaded) ? (downloaded as RecallTranscriptEntry[]) : []);
    visit.status = "ready";
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);

    await runScribe(visit, ai);
    visit.updatedAt = new Date().toISOString();
    db.saveVisit(visit);
  }
}

function findVisit(db: Storage, event: RecallWebhook): Visit | undefined {
  const visitId =
    event.data.bot?.metadata?.visitId ?? event.data.transcript?.metadata?.visitId;
  return visitId ? db.getVisit(visitId) : undefined;
}

function readableText(words: Array<{ text?: string | null }>): string {
  return words
    .map((word) => word.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join(" ");
}

function toTranscript(entries: RecallTranscriptEntry[]): TranscriptUtterance[] {
  return entries
    .map((entry) => ({
      speaker: entry.participant?.name ?? null,
      isHost: entry.participant?.is_host ?? null,
      text: readableText(entry.words ?? []),
      startSeconds: entry.words?.[0]?.start_timestamp?.relative ?? null,
      endSeconds: entry.words?.at(-1)?.end_timestamp?.relative ?? null,
    }))
    .filter((entry) => Boolean(entry.text));
}

// Recall signs raw webhook payloads with HMAC-SHA256 over `id.timestamp.body`.
export function verifyRequestFromRecall(args: {
  secret: string;
  headers: Record<string, string | string[] | undefined>;
  payload: string | null;
}): void {
  const { secret, payload } = args;
  const header = (name: string) => {
    const value = args.headers[name];
    return Array.isArray(value) ? value.join(",") : value;
  };
  const msgId = header("webhook-id") ?? header("svix-id");
  const msgTimestamp = header("webhook-timestamp") ?? header("svix-timestamp");
  const msgSignature = header("webhook-signature") ?? header("svix-signature");

  if (!secret?.startsWith("whsec_")) {
    throw new Error("Verification secret is missing or invalid");
  }
  if (!msgId || !msgTimestamp || !msgSignature) {
    throw new Error("Missing webhook ID, timestamp, or signature");
  }

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(`${msgId}.${msgTimestamp}.${payload ?? ""}`)
    .digest("base64");

  // The header holds space-separated "v1,<signature>" pairs.
  for (const versionedSig of msgSignature.split(" ")) {
    const [version, signature] = versionedSig.split(",");
    if (version !== "v1" || !signature) continue;
    const received = Buffer.from(signature, "base64");
    const expected = Buffer.from(expectedSig, "base64");
    if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) {
      return;
    }
  }

  throw new Error("No matching signature found");
}

// Webhook payload shapes. https://docs.recall.ai/docs/bot-status-change-events
export type RecallResource = { id: string; metadata?: Record<string, string> | null };
export type RecallWebhook = {
  event: string;
  data: {
    data?: { code?: string; sub_code?: string | null; updated_at?: string };
    bot?: RecallResource;
    recording?: RecallResource;
    transcript?: RecallResource;
  };
};
export type RecallEvent = RecallWebhook | RecallCalendarWebhook;
export function isCalendarEvent(event: RecallEvent): event is RecallCalendarWebhook {
  return event.event.startsWith("calendar.");
}

export type RecallTranscriptEntry = {
  participant?: { id?: number | null; name?: string | null; is_host?: boolean | null } | null;
  words?: Array<{
    text?: string | null;
    start_timestamp?: { relative?: number | null } | null;
    end_timestamp?: { relative?: number | null } | null;
  }>;
};
