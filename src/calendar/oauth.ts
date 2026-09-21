import { constants, createHash, randomUUID, sign, X509Certificate } from "crypto";
import type { CalendarPlatform } from "./model";

export type ProviderName = "google" | "microsoft";

type ProviderConfig = {
  label: string;
  /** How Recall names this provider. */
  platform: CalendarPlatform;
  authorizeUrl: string;
  tokenUrl: string;
  /** OIDC userinfo endpoint, used to learn the connected account's email. */
  userinfoUrl: string;
  scopes: string[];
  extraAuthorizeParams: Record<string, string>;
  /** Microsoft only: a certificate can replace the client secret. */
  supportsCertificate: boolean;
};

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  [key: string]: unknown;
};

/** OAuth client credentials, with PEM *contents* rather than file paths. */
export type ClientCredentials = {
  clientId: string;
  clientSecret: string;
  certificate: string;
  privateKey: string;
};

export const PROVIDER_NAMES: ProviderName[] = ["google", "microsoft"];

export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  google: {
    label: "Google Calendar",
    platform: "google_calendar",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    extraAuthorizeParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    supportsCertificate: false,
  },
  microsoft: {
    label: "Microsoft Outlook",
    platform: "microsoft_outlook",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userinfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    scopes: [
      "offline_access",
      "openid",
      "email",
      "https://graph.microsoft.com/Calendars.Read",
    ],
    extraAuthorizeParams: { response_mode: "query" },
    supportsCertificate: true,
  },
};

export function buildAuthorizeUrl(
  provider: ProviderName,
  { clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string },
): string {
  const config = PROVIDERS[provider];
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    ...config.extraAuthorizeParams,
  }).toString();
  return url.toString();
}

export async function exchangeCode(
  provider: ProviderName,
  {
    code,
    credentials,
    redirectUri,
  }: { code: string; credentials: ClientCredentials; redirectUri: string },
): Promise<OAuthTokens> {
  const config = PROVIDERS[provider];
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      ...(usesCertificate(provider, credentials)
        ? {
            client_assertion_type:
              "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            client_assertion: buildClientAssertion({
              tokenUrl: config.tokenUrl,
              clientId: credentials.clientId,
              certificate: credentials.certificate,
              privateKey: credentials.privateKey,
            }),
          }
        : { client_secret: credentials.clientSecret }),
    }),
  });

  const data = (await response.json()) as OAuthTokens;
  if (!response.ok) {
    throw new Error(`${provider} token exchange failed: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function fetchAccountEmail(
  provider: ProviderName,
  accessToken: string,
): Promise<string> {
  try {
    const response = await fetch(PROVIDERS[provider].userinfoUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    const { email } = (await response.json()) as { email?: string };
    return (email ?? "").trim().toLowerCase();
  } catch (error) {
    console.warn(
      `Could not read ${provider} account email: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "";
  }
}

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && (PROVIDER_NAMES as string[]).includes(value);
}

export function usesCertificate(
  provider: ProviderName,
  credentials: ClientCredentials,
): boolean {
  return Boolean(
    PROVIDERS[provider].supportsCertificate && credentials.certificate && credentials.privateKey,
  );
}

function buildClientAssertion({
  tokenUrl,
  clientId,
  certificate,
  privateKey,
}: {
  tokenUrl: string;
  clientId: string;
  certificate: string;
  privateKey: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const parsed = new X509Certificate(certificate);

  const header = {
    typ: "JWT",
    alg: "PS256",
    "x5t#S256": createHash("sha256").update(parsed.raw).digest("base64url"),
  };
  const claims = {
    aud: tokenUrl,
    iss: clientId,
    sub: clientId,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 600,
  };

  const unsigned =
    `${Buffer.from(JSON.stringify(header)).toString("base64url")}.` +
    Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString("base64url");

  return `${unsigned}.${signature}`;
}
