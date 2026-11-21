import type { AntigravitySettings, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import {
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

export function antigravityUserAgent(platform: NodeJS.Platform, architecture: NodeJS.Architecture) {
  return `antigravity/hub/2.24.0 (aidev_client; os_type=${platform}; arch=${architecture}; cl=963137146)`;
}

const ANTIGRAVITY_SIGN_IN_LIMITS_MESSAGE = "Sign in with Google to see Antigravity limits.";
export const ANTIGRAVITY_CREDENTIALS_UNREADABLE_MESSAGE =
  "Antigravity limits are unavailable: T3 Code could not read the agy sign-in from the OS keychain (access was denied or no sign-in was found). Allow keychain access and refresh provider status.";

// The native agy CLI stores its Google token via go-keyring, shared by every instance (not per --gemini-dir).
const KEYRING_SERVICE = "gemini";
const KEYRING_ACCOUNT = "antigravity";
export const ANTIGRAVITY_LIMITS_EXPIRED_MESSAGE =
  "Antigravity limits are unavailable: the agy sign-in has expired and T3 Code cannot refresh it. Limits will appear once Antigravity refreshes its sign-in.";
// agy embeds its installed-app OAuth clients; read them from the installed binary instead of vendoring them.
const CLIENT_ID_PATTERN = /\d{6,}-[a-z0-9]{32}\.apps\.googleusercontent\.com/g;
const CLIENT_SECRET_PATTERN = /GOCSPX-[A-Za-z0-9_-]{28}/g;

type OAuthClient = { readonly clientId: string; readonly clientSecret: string };

/** Every client id x secret pair found in an agy binary; Go strings are packed, so patterns use fixed lengths. */
export function extractAntigravityOAuthClients(binary: Uint8Array): ReadonlyArray<OAuthClient> {
  const text = Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength).toString("latin1");
  const ids = new Set(text.match(CLIENT_ID_PATTERN) ?? []);
  const secrets = new Set(text.match(CLIENT_SECRET_PATTERN) ?? []);
  return [...ids].flatMap((clientId) =>
    [...secrets].map((clientSecret) => ({ clientId, clientSecret })),
  );
}

const DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const PROD_ENDPOINT = "https://cloudcode-pa.googleapis.com";
// The ACP runtime meters consumer tiers on the daily host and GCP-terms tiers on prod.
// The sign-in method stands in for the tier.
const ENDPOINTS = {
  "oauth-personal": [DAILY_ENDPOINT, PROD_ENDPOINT],
  "oauth-business": [PROD_ENDPOINT, DAILY_ENDPOINT],
};
const SUMMARY_WINDOW_MINS = new Map([
  ["5h", 5 * 60],
  ["weekly", 7 * 24 * 60],
]);
const MANUAL_REDIRECT: RequestInit = { redirect: "manual" };
const TokenFile = Schema.Struct({
  client_id: Schema.NonEmptyString,
  client_secret: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  project_id: Schema.optional(Schema.String),
});
const StoredToken = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expiry: Schema.optional(Schema.String),
});
// agy nests the oauth2 token under `token`; accept a bare token too.
const KeyringPayload = Schema.Struct({
  ...StoredToken.fields,
  token: Schema.optional(StoredToken),
  project_id: Schema.optional(Schema.String),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.Number.check(Schema.isGreaterThan(0)),
});
const UserInfo = Schema.Struct({ id: Schema.NonEmptyString });
const Quota = Schema.Struct({
  remainingFraction: Schema.optional(Schema.Number),
  resetTime: Schema.optional(Schema.String),
});
const Bucket = Schema.Struct({
  ...Quota.fields,
  bucketId: Schema.NonEmptyString,
  window: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
});
const Summary = Schema.Struct({
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        displayName: Schema.optional(Schema.String),
        buckets: Schema.optional(Schema.Array(Bucket)),
      }),
    ),
  ),
  buckets: Schema.optional(Schema.Array(Bucket)),
});
const Models = Schema.Struct({
  models: Schema.Record(
    Schema.String,
    Schema.Struct({
      modelProvider: Schema.optional(Schema.String),
      quotaInfo: Schema.optional(Quota),
      weeklyQuotaInfo: Schema.optional(Quota),
    }),
  ),
});

const decodeTokenFile = Schema.decodeEffect(Schema.fromJsonString(TokenFile));
const decodeKeyringPayload = Schema.decodeEffect(Schema.fromJsonString(KeyringPayload));
const decodeTokenResponse = Schema.decodeUnknownEffect(TokenResponse);
const decodeUserInfo = Schema.decodeUnknownEffect(UserInfo);
const decodeSummary = Schema.decodeUnknownEffect(Summary);
const decodeModels = Schema.decodeUnknownEffect(Models);

function iso(value: string | undefined): string | undefined {
  const parsed = value ? DateTime.make(value) : Option.none();
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : undefined;
}

function quotaWindow(
  id: string,
  label: string,
  quota: typeof Quota.Type,
  kind: ServerProviderUsageWindow["kind"] = "other",
  windowDurationMins?: number,
): ServerProviderUsageWindow | undefined {
  if (quota.remainingFraction === undefined || !Number.isFinite(quota.remainingFraction)) {
    return undefined;
  }
  const resetsAt = iso(quota.resetTime);
  return {
    id,
    label,
    kind,
    usedPercent: (1 - Math.max(0, Math.min(1, quota.remainingFraction))) * 100,
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
  };
}

function summaryResetTime(
  bucket: typeof Bucket.Type,
  windowDurationMins: number | undefined,
  requestedAt: number,
): string | undefined {
  // Untouched summary buckets report a rolling full-window reset.
  const untouched =
    bucket.remainingFraction === 1 &&
    bucket.description === undefined &&
    windowDurationMins !== undefined &&
    Math.abs(Date.parse(bucket.resetTime ?? "") - requestedAt - windowDurationMins * 60_000) <=
      60_000;
  return untouched ? undefined : bucket.resetTime;
}

/** Undoes go-keyring's `go-keyring-base64:`/`go-keyring-encoded:` prefixes and macOS `security` hex output. */
export function decodeKeyringSecret(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("go-keyring-base64:")) {
    return Buffer.from(value.slice("go-keyring-base64:".length), "base64").toString("utf8");
  }
  if (value.startsWith("go-keyring-encoded:")) {
    return Buffer.from(value.slice("go-keyring-encoded:".length), "hex").toString("utf8");
  }
  if (/^(?:[0-9a-f]{2})+$/i.test(value)) return Buffer.from(value, "hex").toString("utf8");
  return value;
}

const sha256 = Effect.fnUntraced(function* (text: string) {
  const digest = yield* (yield* Digest.Digest).digest(
    Digest.sha256,
    new TextEncoder().encode(text),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
});

/** Keys an account by its Google ID, which matches across machines and hubs; refresh tokens do not. */
export const antigravityAccountFingerprint = (userInfo: unknown) =>
  decodeUserInfo(userInfo).pipe(Effect.flatMap((info) => sha256(`google-account\0${info.id}`)));

/** Windows from a `retrieveUserQuotaSummary` answer requested at `requestedAt`. */
export const antigravitySummaryWindows = (response: unknown, requestedAt: number) =>
  decodeSummary(response).pipe(Effect.map((summary) => summaryWindows(summary, requestedAt)));

function summaryWindows(summary: typeof Summary.Type, requestedAt: number) {
  const windows = new Map<string, ServerProviderUsageWindow>();
  const groups = summary.groups?.some((group) => group.buckets?.length)
    ? summary.groups
    : [{ buckets: summary.buckets }];
  for (const group of groups ?? []) {
    for (const bucket of group.buckets ?? []) {
      if (bucket.disabled) continue;
      // Argon and Carbon are metered separately from the default Gemini buckets.
      const family = bucket.bucketId.startsWith("gemini-argon-")
        ? group.displayName?.trim() || "Gemini Argon"
        : bucket.bucketId.startsWith("gemini-carbon-")
          ? group.displayName?.trim() || "Gemini Carbon"
          : bucket.bucketId.startsWith("gemini-")
            ? "Gemini"
            : bucket.bucketId.startsWith("3p-")
              ? "Claude & GPT (shared)"
              : group.displayName?.trim() || bucket.bucketId;
      const weekly = bucket.window === "weekly";
      const session = bucket.window === "5h";
      const windowDurationMins = SUMMARY_WINDOW_MINS.get(bucket.window ?? "");
      const window = quotaWindow(
        bucket.bucketId,
        `${family} · ${weekly ? "Weekly" : session ? "5-hour" : bucket.displayName?.trim() || "Quota"}`,
        { ...bucket, resetTime: summaryResetTime(bucket, windowDurationMins, requestedAt) },
        weekly ? "weekly" : session ? "session" : "other",
        windowDurationMins,
      );
      if (window) windows.set(window.id, window);
    }
  }
  return [...windows.values()];
}

/** Older accounts expose model quotas without a window length. Do not invent a reset cadence. */
function modelWindows(models: typeof Models.Type) {
  const windows = new Map<string, ServerProviderUsageWindow>();
  for (const [modelId, model] of Object.entries(models.models)) {
    const family =
      model.modelProvider === "MODEL_PROVIDER_GOOGLE" || modelId.startsWith("gemini-")
        ? "Gemini"
        : model.modelProvider === "MODEL_PROVIDER_ANTHROPIC" || modelId.startsWith("claude-")
          ? "Claude"
          : model.modelProvider === "MODEL_PROVIDER_OPENAI" || modelId.startsWith("gpt-")
            ? "GPT"
            : undefined;
    if (!family) continue;
    for (const [suffix, quota] of [
      ["quota", model.quotaInfo],
      ["weekly", model.weeklyQuotaInfo],
    ] as const) {
      if (!quota) continue;
      const window = quotaWindow(
        `${family.toLowerCase()}-${suffix}`,
        `${family} · ${suffix === "weekly" ? "Weekly" : "Reported quota"}`,
        quota,
        suffix === "weekly" ? "weekly" : "other",
        suffix === "weekly" ? 7 * 24 * 60 : undefined,
      );
      if (!window) continue;
      const previous = windows.get(window.id);
      if (!previous || window.usedPercent > previous.usedPercent) windows.set(window.id, window);
    }
  }
  return [...windows.values()];
}

export const makeAntigravityUsageProbe = Effect.fn("makeAntigravityUsageProbe")(function* (input: {
  readonly profileDirectory: string;
  readonly authMethod: AntigravitySettings["authMethod"];
  /** Resolves the installed agy binary the way the driver does; none disables refresh. */
  readonly resolveBinaryPath?: Effect.Effect<Option.Option<string>>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const crypto = yield* Digest.Digest;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const architecture = yield* HostProcess.Architecture;
  const tokenPath = path.join(input.profileDirectory, "antigravity-acp", "acp_token.json");
  let cached:
    | {
        source: "file" | "keyring";
        fingerprint: string;
        account: string;
        accessToken: string;
        expiresAt: number;
        projectId?: string;
      }
    | undefined;
  let generation = 0;

  const request = (request: HttpClientRequest.HttpClientRequest) =>
    client.execute(request).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout("10 seconds"),
    );
  let clientCache:
    | { key: string; candidates: ReadonlyArray<OAuthClient>; working?: OAuthClient }
    | undefined;
  // One scan per agy binary version, keyed by path, size and mtime.
  const loadClientCache = Effect.gen(function* () {
    const binaryPath = yield* input.resolveBinaryPath ?? Effect.succeed(Option.none<string>());
    if (Option.isNone(binaryPath)) return undefined;
    const stat = yield* fs.stat(binaryPath.value);
    const mtime = Option.getOrUndefined(stat.mtime)?.getTime() ?? 0;
    const key = `${binaryPath.value}\0${stat.size}\0${mtime}`;
    if (clientCache?.key !== key) {
      const candidates = extractAntigravityOAuthClients(yield* fs.readFile(binaryPath.value));
      clientCache = { key, candidates };
    }
    return clientCache;
  }).pipe(Effect.orElseSucceed(() => undefined));
  const refreshWithClients = Effect.fn("AntigravityUsageProbe.refreshWithClients")(function* (
    refreshToken: string,
  ) {
    const entry = yield* loadClientCache;
    if (!entry || entry.candidates.length === 0) {
      return yield* Effect.fail("no refresh client" as const);
    }
    // Try the pair that worked last, then the rest once.
    const ordered = [
      ...(entry.working ? [entry.working] : []),
      ...entry.candidates.filter((client) => client !== entry.working),
    ];
    for (const client of ordered) {
      const refreshed = yield* refreshAccessToken(client, refreshToken).pipe(Effect.option);
      if (Option.isSome(refreshed)) {
        entry.working = client;
        return refreshed.value;
      }
    }
    return yield* Effect.fail("refresh failed" as const);
  });
  const refreshAccessToken = (
    client: { clientId: string; clientSecret: string },
    refreshToken: string,
  ) =>
    request(
      HttpClientRequest.post("https://oauth2.googleapis.com/token").pipe(
        HttpClientRequest.bodyUrlParams({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      ),
    ).pipe(
      Effect.flatMap(decodeTokenResponse),
      Effect.map((refreshed) => ({
        accessToken: refreshed.access_token,
        expiresInMs: refreshed.expires_in * 1000,
      })),
    );
  // Read-only: never write the keychain. Windows is unsupported, so it reports the unreadable notice.
  const readKeyringSecret = Effect.gen(function* () {
    const command =
      platform === "darwin"
        ? ChildProcess.make(
            "/usr/bin/security",
            ["find-generic-password", "-s", KEYRING_SERVICE, "-a", KEYRING_ACCOUNT, "-w"],
            { stdin: "ignore", stderr: "ignore" },
          )
        : platform === "linux"
          ? ChildProcess.make(
              "secret-tool",
              ["lookup", "service", KEYRING_SERVICE, "username", KEYRING_ACCOUNT],
              { stdin: "ignore", stderr: "ignore" },
            )
          : undefined;
    if (!command) return yield* Effect.fail("unsupported platform");
    const child = yield* spawner.spawn(command);
    const [stdout, exitCode] = yield* Effect.all(
      [child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.exitCode],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0 || stdout.trim() === "") return yield* Effect.fail("no keyring entry");
    return decodeKeyringSecret(stdout);
  }).pipe(Effect.scoped, Effect.timeout("25 seconds"));
  const readKeyringCredential = readKeyringSecret.pipe(
    Effect.flatMap(decodeKeyringPayload),
    Effect.flatMap((payload) => {
      const stored = payload.token ?? payload;
      const refreshToken = stored.refresh_token || undefined;
      const accessToken = stored.access_token || undefined;
      if (!refreshToken && !accessToken) return Effect.fail("empty keyring token");
      return sha256(`keyring\0${refreshToken ?? accessToken}`).pipe(
        Effect.map((fingerprint) => ({
          fingerprint,
          projectId: payload.project_id || undefined,
          mint: Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const expiresAt = stored.expiry ? Date.parse(stored.expiry) : Number.NaN;
            // agy refreshes its own token, so a stored access token is usually still fresh.
            if (accessToken && expiresAt > now + 60_000) {
              return { accessToken, expiresInMs: expiresAt - now };
            }
            if (!refreshToken) return yield* Effect.fail("no refresh client" as const);
            return yield* refreshWithClients(refreshToken);
          }),
        })),
      );
    }),
    Effect.option,
  );
  const read = Effect.fn("AntigravityUsageProbe.read")(function* (signedOut: boolean) {
    const startedGeneration = generation;
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    if (input.authMethod !== "oauth-personal" && input.authMethod !== "oauth-business") {
      return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    }
    const now = yield* Clock.currentTimeMillis;
    const hasTokenFile = yield* fs.exists(tokenPath);
    // A signed-out instance never reads the keychain, so it never sees the access prompt.
    if (!hasTokenFile && signedOut) {
      cached = undefined;
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: ANTIGRAVITY_SIGN_IN_LIMITS_MESSAGE,
      });
    }
    let session: { accessToken: string; account: string; projectId?: string | undefined };
    if (!hasTokenFile && cached?.source === "keyring" && cached.expiresAt > now + 60_000) {
      session = cached;
    } else {
      let credential: {
        fingerprint: string;
        projectId?: string | undefined;
        mint: Effect.Effect<
          { accessToken: string; expiresInMs: number },
          "refresh failed" | "no refresh client"
        >;
      };
      if (hasTokenFile) {
        const token = yield* fs.readFileString(tokenPath).pipe(Effect.flatMap(decodeTokenFile));
        credential = {
          fingerprint: yield* sha256(
            `${token.client_id}\0${token.refresh_token}\0${token.project_id ?? ""}`,
          ),
          projectId: token.project_id,
          mint: refreshAccessToken(
            { clientId: token.client_id, clientSecret: token.client_secret },
            token.refresh_token,
          ).pipe(Effect.mapError(() => "refresh failed" as const)),
        };
      } else {
        cached = undefined;
        const keyring = yield* readKeyringCredential;
        if (Option.isNone(keyring)) {
          return makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: ANTIGRAVITY_CREDENTIALS_UNREADABLE_MESSAGE,
          });
        }
        credential = keyring.value;
      }
      if (
        hasTokenFile &&
        cached?.source === "file" &&
        cached.fingerprint === credential.fingerprint &&
        cached.expiresAt > now + 60_000
      ) {
        session = cached;
      } else {
        cached = undefined;
        const attempt = yield* Effect.result(credential.mint);
        if (Result.isFailure(attempt)) {
          if (attempt.failure !== "no refresh client") return yield* Effect.fail(attempt.failure);
          return makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: ANTIGRAVITY_LIMITS_EXPIRED_MESSAGE,
          });
        }
        const minted = attempt.success;
        // Use Google account IDs to merge accounts across environments; refresh tokens differ per machine.
        const account = yield* request(
          HttpClientRequest.get("https://www.googleapis.com/oauth2/v2/userinfo").pipe(
            HttpClientRequest.setHeaders({ Authorization: `Bearer ${minted.accessToken}` }),
          ),
        ).pipe(
          Effect.flatMap(antigravityAccountFingerprint),
          Effect.orElseSucceed(() => credential.fingerprint),
        );
        session = { accessToken: minted.accessToken, account, projectId: credential.projectId };
        if (generation === startedGeneration) {
          cached = {
            source: hasTokenFile ? "file" : "keyring",
            fingerprint: credential.fingerprint,
            account,
            accessToken: minted.accessToken,
            expiresAt: now + minted.expiresInMs,
            ...(credential.projectId ? { projectId: credential.projectId } : {}),
          };
        }
      }
    }
    const { accessToken, account } = session;
    const endpoints = ENDPOINTS[input.authMethod];
    // Merge endpoints because quota groups differ; the metered host's reading of a bucket wins.
    const fetchWindows = Effect.fn("AntigravityUsageProbe.fetchWindows")(function* <E>(
      operation: string,
      parse: (
        response: unknown,
        requestedAt: number,
      ) => Effect.Effect<ServerProviderUsageWindow[], E>,
    ) {
      const responses = yield* Effect.forEach(
        endpoints,
        (endpoint) =>
          Effect.gen(function* () {
            // Capture each request after auth, so refresh latency does not widen the tolerance.
            const requestedAt = yield* Clock.currentTimeMillis;
            return yield* request(
              HttpClientRequest.post(`${endpoint}/v1internal:${operation}`).pipe(
                HttpClientRequest.setHeaders({
                  Authorization: `Bearer ${accessToken}`,
                  "User-Agent": antigravityUserAgent(platform, architecture),
                }),
                HttpClientRequest.bodyJsonUnsafe(
                  session.projectId ? { project: session.projectId } : {},
                ),
              ),
            ).pipe(
              Effect.flatMap((response) => parse(response, requestedAt)),
              Effect.orElseSucceed(() => []),
            );
          }),
        { concurrency: "unbounded" },
      );
      const windows = new Map<string, ServerProviderUsageWindow>();
      for (const window of responses.flat()) {
        if (!windows.has(window.id)) windows.set(window.id, window);
      }
      return [...windows.values()];
    });
    const summary = yield* fetchWindows("retrieveUserQuotaSummary", antigravitySummaryWindows);
    const windows = summary.length
      ? summary
      : yield* fetchWindows("fetchAvailableModels", (response) =>
          decodeModels(response).pipe(Effect.map(modelWindows)),
        );
    if (windows.length === 0) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Antigravity did not return usable quota information.",
      });
    }
    return { ...makeUsageLimits({ checkedAt, windows }), credentialFingerprint: account };
  });
  const probe = (state: { readonly signedOut: boolean }) =>
    read(state.signedOut).pipe(
      Effect.provideService(Digest.Digest, crypto),
      Effect.timeout("30 seconds"),
      Effect.catch(() =>
        Effect.gen(function* () {
          return makeUnavailableUsageLimits({
            checkedAt: DateTime.formatIso(yield* DateTime.now),
            reason: "probeFailed",
            message: "Could not read Antigravity limits. Refresh provider status to retry.",
          });
        }),
      ),
    );
  return {
    probe,
    clear: Effect.sync(() => {
      cached = undefined;
      generation++;
    }),
  };
});
