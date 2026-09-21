import fs from "fs";
import path from "path";
import { type ClientCredentials, PROVIDER_NAMES, PROVIDERS, type ProviderName } from "./calendar/oauth";
import type { NoteFormat } from "./visits";

export type AiProvider = "anthropic" | "openai";

export type Config = {
  port: number;
  recallRegion: string;
  recallApiKey: string;
  recallWebhookSecret: string;
  databasePath: string;
  assetsDir: string;
  aiProvider: AiProvider;
  aiApiKey: string;
  aiModel: string;
  noteFormat: NoteFormat;
  recordVideo: boolean;
  /** Public base URL, needed for OAuth redirect URIs. Null disables calendars. */
  publicUrl: string | null;
  oauthClients: Record<ProviderName, ClientCredentials>;
};

const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai"];

const AI_KEY_VAR: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

const REQUIRED = [
  "RECALL_REGION",
  "RECALL_API_KEY",
  "RECALL_WEBHOOK_VERIFICATION_SECRET",
] as const;

const NOTE_FORMATS: NoteFormat[] = ["soap", "dap", "birp"];

// Override the provider's default model with AI_MODEL.
const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const aiProvider = (env.AI_PROVIDER?.trim() || "anthropic") as AiProvider;
  if (!AI_PROVIDERS.includes(aiProvider)) {
    throw new Error(`AI_PROVIDER must be one of ${AI_PROVIDERS.join(", ")}, got "${aiProvider}"`);
  }
  const aiKeyVar = AI_KEY_VAR[aiProvider];
  const aiApiKey = env[aiKeyVar]?.trim();
  if (!aiApiKey) {
    throw new Error(`Missing ${aiKeyVar} (required when AI_PROVIDER=${aiProvider})`);
  }

  const noteFormat = (env.NOTE_FORMAT?.trim() || "soap") as NoteFormat;
  if (!NOTE_FORMATS.includes(noteFormat)) {
    throw new Error(`NOTE_FORMAT must be one of ${NOTE_FORMATS.join(", ")}`);
  }

  return {
    port: Number(env.PORT || 3000),
    recallRegion: env.RECALL_REGION!.trim(),
    recallApiKey: env.RECALL_API_KEY!.trim(),
    recallWebhookSecret: env.RECALL_WEBHOOK_VERIFICATION_SECRET!.trim(),
    databasePath: path.resolve(env.DATABASE_PATH || path.join(process.cwd(), "data", "scribe.db")),
    assetsDir: path.resolve(env.ASSETS_DIR || path.join(process.cwd(), "assets")),
    aiProvider,
    aiApiKey,
    aiModel: env.AI_MODEL?.trim() || DEFAULT_MODEL[aiProvider],
    noteFormat,
    recordVideo: env.RECORD_VIDEO?.trim().toLowerCase() !== "false",
    publicUrl: env.PUBLIC_URL?.trim().replace(/\/$/, "") || null,
    oauthClients: oauthClients(env),
  };
}

/**
 * A provider is usable once it has a client ID, one form of credential, and a
 * public URL to send the OAuth redirect back to.
 */
export function calendarProviderReady(config: Config, provider: ProviderName): boolean {
  const credentials = config.oauthClients[provider];
  const hasCredential =
    Boolean(credentials.clientSecret) ||
    (PROVIDERS[provider].supportsCertificate &&
      Boolean(credentials.certificate && credentials.privateKey));
  return Boolean(config.publicUrl && credentials.clientId && hasCredential);
}

export function enabledCalendarProviders(config: Config): ProviderName[] {
  return PROVIDER_NAMES.filter((provider) => calendarProviderReady(config, provider));
}

/**
 * Recall needs the certificate and private key as PEM *contents*, but a
 * multi-line value is awkward in a .env, so they're configured as file paths
 * and read here.
 */
function readPem(file: string): string {
  if (!file) return "";
  try {
    return fs.readFileSync(path.resolve(file), "utf8");
  } catch (error) {
    console.warn(
      `Could not read PEM file ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "";
  }
}

function oauthClients(env: NodeJS.ProcessEnv): Record<ProviderName, ClientCredentials> {
  return {
    google: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "",
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "",
      certificate: "",
      privateKey: "",
    },
    microsoft: {
      clientId: env.MICROSOFT_OAUTH_CLIENT_ID?.trim() || "",
      clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() || "",
      certificate: readPem(env.MICROSOFT_OAUTH_CERTIFICATE_PATH?.trim() || ""),
      privateKey: readPem(env.MICROSOFT_OAUTH_PRIVATE_KEY_PATH?.trim() || ""),
    },
  };
}
