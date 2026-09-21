import fs from "fs";
import path from "path";
import axios, { isAxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import type { Config } from "./config";
import type { Visit } from "./visits";

export type RecallApi = AxiosInstance;

const CAPACITY_RETRY_DELAY_MS = 30_000;
const CAPACITY_RETRY_ATTEMPTS = 3;
const RATE_LIMIT_MAX_RETRIES = 3;

/** Shown in the participant list, so keep it recognisable to the patient. */
const BOT_NAME = "AI Scribe Sample Application";
const NOTICE = "This visit is being recorded for clinical notes.";

/**
 * Every Recall API call goes through here. Keys and data are per-region, so the
 * host is too. https://docs.recall.ai/docs/regions
 */
export function createRecallApi(config: Config): RecallApi {
  const api = axios.create({
    baseURL: `https://${config.recallRegion}.recall.ai`,
    headers: {
      authorization: config.recallApiKey.startsWith("Token ")
        ? config.recallApiKey
        : `Token ${config.recallApiKey}`,
    },
  });

  api.interceptors.response.use(undefined, async (error: unknown) => {
    if (isAxiosError(error) && error.response) {
      const request = error.config as (InternalAxiosRequestConfig & { rateLimitRetries?: number }) | undefined;
      if (error.response.status === 429 && request) {
        const retries = request.rateLimitRetries ?? 0;
        if (retries < RATE_LIMIT_MAX_RETRIES) {
          // Recall's Retry-After is in seconds; back off if it is missing or invalid.
          const seconds = Number(error.response.headers["retry-after"] ?? NaN);
          const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds : 2 ** retries;
          request.rateLimitRetries = retries + 1;
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
          return api.request(request);
        }
      }

      const body =
        typeof error.response.data === "string"
          ? error.response.data
          : JSON.stringify(error.response.data);
      const method = error.config?.method?.toUpperCase() ?? "";
      // `config.url` is the path as the caller wrote it, so name the region the
      // request went to — unless it is already absolute, as `next` links are.
      const path = error.config?.url ?? "";
      const url = /^https?:\/\//.test(path) ? path : `${error.config?.baseURL ?? ""}${path}`;
      error.message = `Recall ${error.response.status} ${method} ${url}: ${body}`;
    }
    return Promise.reject(error);
  });

  return api;
}

/** The Create Bot body, also used as the `bot_config` for a calendar event. */
export function botConfig(visit: Visit, config: Config): Record<string, unknown> {
  const recording = cameraImage(path.join(config.assetsDir, "bot-recording.jpg"));
  const paused = cameraImage(path.join(config.assetsDir, "bot-paused.jpg"));

  return {
    bot_name: BOT_NAME,
    // Bot, recording, and transcript webhooks all include the bot and its
    // metadata, which is how an event is matched to a visit.
    metadata: { visitId: visit.id },
    recording_config: {
      video_mixed_mp4: visit.recordVideo ? {} : null,
      ...(!visit.recordVideo && { audio_mixed_mp3: {} }),
    },
    chat: {
      on_bot_join: { send_to: "everyone", message: NOTICE, pin: true },
      on_participant_join: { exclude_host: false, message: NOTICE },
    },
    ...((recording || paused) && {
      automatic_video_output: {
        ...(recording && { in_call_recording: recording }),
        ...(paused && { in_call_not_recording: paused }),
      },
    }),
  };
}

/**
 * Follow Recall's `next` links until they run out. `next` is an absolute URL,
 * which axios uses as-is instead of resolving it against `baseURL`.
 */
export async function listAll<T>(
  api: RecallApi,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
  const collected: T[] = [];
  let url: string | null = path;
  while (url) {
    // `next` already carries the query string, so only the first page needs params.
    const { data }: { data: T[] | Page<T> } = await api.get(url, {
      params: url === path ? params : undefined,
    });
    if (Array.isArray(data)) return data;
    collected.push(...(data.results ?? []));
    url = data.next;
  }
  return collected;
}

/**
 * Retry capacity errors from Create Bot and Calendar V2 scheduling every 30s.
 * https://docs.recall.ai/reference/errors#507-insufficient-storage
 */
export async function retryAfterCapacityError<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= CAPACITY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const outOfCapacity = isAxiosError(error) && error.response?.status === 507;
      if (!outOfCapacity || attempt === CAPACITY_RETRY_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, CAPACITY_RETRY_DELAY_MS));
    }
  }
  throw new Error("Capacity retry loop ended unexpectedly");
}

/** https://docs.recall.ai/docs/output-video-in-meetings */
function cameraImage(file: string): { kind: "jpeg"; b64_data: string } | undefined {
  if (!fs.existsSync(file)) return;
  return { kind: "jpeg", b64_data: fs.readFileSync(file).toString("base64") };
}

type Page<T> = { next: string | null; results?: T[] };

// Artifact shapes. Full schemas: https://docs.recall.ai/reference
export type RecallArtifact = {
  id?: string;
  data?: { download_url?: string | null } | null;
  format?: string | null;
};
export type RecallRecording = {
  id?: string;
  media_shortcuts?: {
    video_mixed?: RecallArtifact | null;
    audio_mixed?: RecallArtifact | null;
    transcript?: RecallArtifact | null;
  } | null;
};
