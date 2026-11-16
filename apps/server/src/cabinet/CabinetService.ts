import {
  CabinetCaptureResult,
  CabinetConflictError,
  CabinetDisabledError,
  CabinetEvent,
  CabinetItem,
  CabinetItemDetail,
  CabinetListItemsResult,
  CabinetNotFoundError,
  CabinetRequestError,
  CabinetResolveResult,
  CabinetSearchResult,
  CabinetSuggestResult,
  CabinetUnauthorizedError,
  CabinetUnavailableError,
  type CabinetAddToProjectInput,
  type CabinetCaptureInput,
  type CabinetCreateItemInput,
  type CabinetError,
  type CabinetGetItemInput,
  type CabinetGetRawResult,
  type CabinetListItemsInput,
  type CabinetResolveInput,
  type CabinetSearchInput,
  type CabinetStatus,
  type CabinetSuggestInput,
  type CabinetTestConnectionInput,
  type CabinetUpdateItemInput,
  type ServerSettings as ServerSettingsValue,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sse from "effect/encoding/Sse";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";

/** Cabinet pings every 25 seconds, so a connection silent this long is dead. */
const SILENCE_LIMIT = Duration.seconds(60);
const REQUEST_TIMEOUT = Duration.seconds(15);
const PROBE_TIMEOUT = Duration.seconds(4);
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** A connection that stayed up this long counts as healthy, so the next retry starts over. */
const HEALTHY_AFTER = Duration.seconds(30);
const IDLE_TIME_TO_LIVE = Duration.seconds(10);

const RESYNC: CabinetEvent = { kind: "resync" };

const decodeEventData = Schema.decodeUnknownOption(Schema.fromJsonString(CabinetEvent));
const decodeItem = Schema.decodeUnknownOption(CabinetItem);
const AuthStatusBody = Schema.Struct({
  via: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Schema.String),
  scopes: Schema.optionalKey(Schema.Array(Schema.String)),
});
const HealthBody = Schema.Struct({ version: Schema.optionalKey(Schema.String) });

interface Connection {
  readonly baseUrl: string;
  readonly token: string;
}

type ConnectionError = CabinetDisabledError | CabinetUnavailableError | CabinetUnauthorizedError;

function normalizeBaseUrl(value: string): string | undefined {
  const url = URL.parse(value.trim());
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return undefined;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const withQuery = (request: HttpClientRequest.HttpClientRequest, query: object | undefined) =>
  query === undefined
    ? request
    : HttpClientRequest.setUrlParams(
        request,
        Object.fromEntries(
          Object.entries(query).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, String(value)]],
          ),
        ),
      );

// A transport error holds the request, headers included, and this error crosses the wire.
const unavailable = (error: { readonly _tag: string }) =>
  new CabinetUnavailableError({ cause: new Error(error._tag) });

export class CabinetService extends Context.Service<
  CabinetService,
  {
    /** Never fails: an unreachable Cabinet is a state, not an error. */
    readonly status: Effect.Effect<CabinetStatus>;
    /** Probes unsaved settings; works while Cabinet is still turned off. */
    readonly testConnection: (input: CabinetTestConnectionInput) => Effect.Effect<CabinetStatus>;
    readonly listItems: (
      input: CabinetListItemsInput,
    ) => Effect.Effect<CabinetListItemsResult, CabinetError>;
    readonly getItem: (
      input: CabinetGetItemInput,
    ) => Effect.Effect<CabinetItemDetail, CabinetError>;
    readonly getRaw: (
      input: CabinetGetItemInput,
    ) => Effect.Effect<CabinetGetRawResult, CabinetError>;
    readonly resolve: (
      input: CabinetResolveInput,
    ) => Effect.Effect<CabinetResolveResult, CabinetError>;
    readonly search: (
      input: CabinetSearchInput,
    ) => Effect.Effect<CabinetSearchResult, CabinetError>;
    readonly suggest: (
      input: CabinetSuggestInput,
    ) => Effect.Effect<CabinetSuggestResult, CabinetError>;
    readonly createItem: (
      input: CabinetCreateItemInput,
    ) => Effect.Effect<CabinetItemDetail, CabinetError>;
    readonly updateItem: (
      input: CabinetUpdateItemInput,
    ) => Effect.Effect<CabinetItemDetail, CabinetError>;
    readonly addToProject: (
      input: CabinetAddToProjectInput,
    ) => Effect.Effect<CabinetItemDetail, CabinetError>;
    readonly capture: (
      input: CabinetCaptureInput,
    ) => Effect.Effect<CabinetCaptureResult, CabinetError>;
    /** An attachment under Cabinet's `attachments/`; any status Cabinet answers is returned as is. */
    readonly fetchFile: (input: {
      readonly path: string;
      readonly headers: Readonly<Record<string, string>>;
    }) => Effect.Effect<HttpClientResponse.HttpClientResponse, CabinetError>;
    /**
     * What changed in Cabinet, shared by every subscriber over one upstream connection that opens
     * with the first of them. `resync` follows each (re)connect: refetch, events may have been missed.
     */
    readonly events: Stream.Stream<CabinetEvent>;
  }
>()("t3/cabinet/CabinetService") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const resolver = yield* SecretResolver.SecretResolver;
  const http = yield* HttpClient.HttpClient;

  const execute = (
    request: HttpClientRequest.HttpClientRequest,
    timeout: Duration.Input = REQUEST_TIMEOUT,
  ) =>
    http.execute(request).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      // Spans would carry the URL, and the request carries the token.
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.timeout(timeout),
      Effect.mapError(unavailable),
    );

  const authorized = (request: HttpClientRequest.HttpClientRequest, connection: Connection) =>
    connection.token === ""
      ? request
      : HttpClientRequest.bearerToken(request, Redacted.make(connection.token));

  const readSettings = settings.getSettings.pipe(
    Effect.mapError((cause) => new CabinetUnavailableError({ cause })),
  );

  const toConnection = Effect.fnUntraced(function* (
    baseUrl: string,
    token: SettingsSecretValue,
  ): Effect.fn.Return<Connection, CabinetUnavailableError | CabinetUnauthorizedError> {
    const normalized = normalizeBaseUrl(baseUrl);
    if (normalized === undefined) {
      return yield* new CabinetUnavailableError({ cause: new Error("invalid base URL") });
    }
    // A named secret that cannot be read must not pass for "no token" and fall back to loopback.
    const secret = yield* requireSettingsSecret(resolver, token).pipe(
      Effect.mapError(() => new CabinetUnauthorizedError({})),
    );
    return { baseUrl: normalized, token: secret };
  });

  const activeConnection = Effect.fnUntraced(function* (): Effect.fn.Return<
    Connection,
    ConnectionError
  > {
    const { cabinet } = yield* readSettings;
    if (!cabinet.enabled) return yield* new CabinetDisabledError({});
    return yield* toConnection(cabinet.baseUrl, cabinet.token);
  });

  const failure = Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
    const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => undefined));
    const record =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const code = typeof record.error === "string" ? record.error.slice(0, 64) : undefined;
    switch (response.status) {
      case 401:
        return new CabinetUnauthorizedError({});
      case 404:
        return new CabinetNotFoundError({});
      case 409: {
        const current = decodeItem(record.current);
        return new CabinetConflictError(Option.isSome(current) ? { current: current.value } : {});
      }
      default:
        return new CabinetRequestError({
          status: response.status,
          ...(code === undefined ? {} : { code }),
        });
    }
  });

  // The calling operation owns the span.
  const send = Effect.fnUntraced(function* (input: {
    readonly method: "GET" | "POST" | "PUT";
    readonly path: string;
    readonly query?: object;
    readonly body?: object;
  }): Effect.fn.Return<HttpClientResponse.HttpClientResponse, CabinetError> {
    const connection = yield* activeConnection();
    const base = withQuery(
      HttpClientRequest.make(input.method)(`${connection.baseUrl}${input.path}`),
      input.query,
    );
    const request = authorized(
      input.body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, input.body),
      connection,
    );
    const response = yield* execute(request);
    if (response.status < 200 || response.status >= 300) return yield* yield* failure(response);
    return response;
  });

  const requestJson = Effect.fnUntraced(function* <
    S extends Schema.Constraint & { readonly DecodingServices: never },
  >(schema: S, input: Parameters<typeof send>[0]): Effect.fn.Return<S["Type"], CabinetError> {
    const response = yield* send(input);
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(
        (cause) =>
          new CabinetRequestError({ status: response.status, code: "invalid_response", cause }),
      ),
    );
  });

  const itemPath = (id: string) => `/api/items/${encodeURIComponent(id)}`;

  const probe = Effect.fnUntraced(function* (connection: Connection) {
    const disconnected: CabinetStatus = { state: "disconnected", baseUrl: connection.baseUrl };
    const health = yield* execute(
      HttpClientRequest.get(`${connection.baseUrl}/api/health`),
      PROBE_TIMEOUT,
    ).pipe(Effect.option);
    if (Option.isNone(health) || health.value.status < 200 || health.value.status >= 300) {
      return disconnected;
    }
    const version = yield* HttpClientResponse.schemaBodyJson(HealthBody)(health.value).pipe(
      Effect.map((body) => body.version),
      Effect.orElseSucceed(() => undefined),
    );
    const withVersion = version === undefined ? {} : { version };
    const auth = yield* execute(
      authorized(HttpClientRequest.get(`${connection.baseUrl}/api/auth/status`), connection),
      PROBE_TIMEOUT,
    ).pipe(Effect.option);
    if (Option.isNone(auth)) return disconnected;
    if (auth.value.status === 401) {
      return { state: "unauthorized", baseUrl: connection.baseUrl, ...withVersion } as const;
    }
    if (auth.value.status < 200 || auth.value.status >= 300) return disconnected;
    const details = yield* HttpClientResponse.schemaBodyJson(AuthStatusBody)(auth.value).pipe(
      Effect.orElseSucceed(() => ({}) as typeof AuthStatusBody.Type),
    );
    return {
      state: "connected",
      baseUrl: connection.baseUrl,
      ...withVersion,
      ...details,
    } satisfies CabinetStatus;
  });

  const probeSettings = Effect.fnUntraced(function* (
    baseUrl: string,
    token: SettingsSecretValue,
  ): Effect.fn.Return<CabinetStatus> {
    return yield* toConnection(baseUrl, token).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.succeed<CabinetStatus>({
            state: error._tag === "CabinetUnauthorizedError" ? "unauthorized" : "disconnected",
            baseUrl,
          }),
        onSuccess: probe,
      }),
    );
  });

  const status = Effect.fn("CabinetService.status")(function* () {
    const current = yield* settings.getSettings.pipe(Effect.option);
    if (Option.isNone(current)) return { state: "disconnected", baseUrl: "" } as const;
    const { cabinet } = current.value;
    if (!cabinet.enabled) return { state: "disabled", baseUrl: cabinet.baseUrl } as const;
    return yield* probeSettings(cabinet.baseUrl, cabinet.token);
  });

  const testConnection = Effect.fn("CabinetService.testConnection")(function* (
    input: CabinetTestConnectionInput,
  ) {
    const current = yield* settings.getSettings.pipe(Effect.option);
    if (Option.isNone(current)) return { state: "disconnected", baseUrl: "" } as const;
    const { cabinet } = current.value;
    const token =
      input.token === undefined || input.token === SECRET_REDACTED ? cabinet.token : input.token;
    return yield* probeSettings(input.baseUrl ?? cabinet.baseUrl, token);
  });

  const listItems = Effect.fn("CabinetService.listItems")(function* (input: CabinetListItemsInput) {
    return yield* requestJson(CabinetListItemsResult, {
      method: "GET",
      path: "/api/items",
      query: input,
    });
  });

  const getItem = Effect.fn("CabinetService.getItem")(function* ({ id }: CabinetGetItemInput) {
    return yield* requestJson(CabinetItemDetail, { method: "GET", path: itemPath(id) });
  });

  const getRaw = Effect.fn("CabinetService.getRaw")(function* ({ id }: CabinetGetItemInput) {
    const response = yield* send({ method: "GET", path: `${itemPath(id)}/raw` });
    const raw = yield* response.text.pipe(Effect.mapError(unavailable));
    return { raw };
  });

  const resolve = Effect.fn("CabinetService.resolve")(function* (input: CabinetResolveInput) {
    return yield* requestJson(CabinetResolveResult, {
      method: "GET",
      path: "/api/resolve",
      query: input,
    });
  });

  const search = Effect.fn("CabinetService.search")(function* (input: CabinetSearchInput) {
    return yield* requestJson(CabinetSearchResult, {
      method: "GET",
      path: "/api/search",
      query: input,
    });
  });

  const suggest = Effect.fn("CabinetService.suggest")(function* (input: CabinetSuggestInput) {
    return yield* requestJson(CabinetSuggestResult, {
      method: "GET",
      path: "/api/suggest",
      query: input,
    });
  });

  const createItem = Effect.fn("CabinetService.createItem")(function* (
    input: CabinetCreateItemInput,
  ) {
    return yield* requestJson(CabinetItemDetail, {
      method: "POST",
      path: "/api/items",
      body: input,
    });
  });

  const updateItem = Effect.fn("CabinetService.updateItem")(function* ({
    id,
    ...body
  }: CabinetUpdateItemInput) {
    return yield* requestJson(CabinetItemDetail, { method: "PUT", path: itemPath(id), body });
  });

  const addToProject = Effect.fn("CabinetService.addToProject")(function* ({
    id,
    ...body
  }: CabinetAddToProjectInput) {
    return yield* requestJson(CabinetItemDetail, {
      method: "POST",
      path: `${itemPath(id)}/project`,
      body,
    });
  });

  const capture = Effect.fn("CabinetService.capture")(function* (input: CabinetCaptureInput) {
    return yield* requestJson(CabinetCaptureResult, {
      method: "POST",
      path: "/api/capture",
      body: input,
    });
  });

  const fetchFile = Effect.fn("CabinetService.fetchFile")(function* (input: {
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
  }) {
    const connection = yield* activeConnection();
    return yield* execute(
      authorized(
        HttpClientRequest.get(`${connection.baseUrl}/files/${encodePath(input.path)}`).pipe(
          HttpClientRequest.setHeaders(input.headers),
        ),
        connection,
      ),
    );
  });

  const backoff = Effect.fnUntraced(function* (failures: number) {
    const jitter = yield* Random.next;
    yield* Effect.sleep(
      Duration.millis(
        Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** failures) * (0.5 + jitter / 2),
      ),
    );
  });

  /** One SSE connection. Ends when it closes, errors, goes silent, or Cabinet refuses it. */
  const connectionEvents = (connection: Connection): Stream.Stream<CabinetEvent> =>
    Stream.unwrap(
      execute(
        authorized(
          HttpClientRequest.get(`${connection.baseUrl}/api/events`).pipe(
            HttpClientRequest.setHeader("accept", "text/event-stream"),
          ),
          connection,
        ),
      ).pipe(
        Effect.map((response) =>
          response.status !== 200
            ? Stream.empty
            : response.stream.pipe(
                Stream.timeoutOrElse({ duration: SILENCE_LIMIT, orElse: () => Stream.empty }),
                Stream.decodeText,
                Stream.pipeThroughChannel(Sse.decode()),
                Stream.flatMap((frame) => {
                  if (frame.event === "hello") return Stream.succeed(RESYNC);
                  if (frame.event !== "library") return Stream.empty;
                  const event = decodeEventData(frame.data);
                  return Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty;
                }),
              ),
        ),
      ),
    ).pipe(
      Stream.catchCause((cause) =>
        Stream.fromEffect(Effect.logDebug("cabinet event stream ended", { cause })).pipe(
          Stream.drain,
        ),
      ),
    );

  /** Reconnects for as long as it runs, backing off while connections fail to do any good. */
  const follow = (connection: Connection): Stream.Stream<CabinetEvent> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const failures = yield* Ref.make(0);
        const attempt = Stream.unwrap(
          Effect.gen(function* () {
            const openedAt = yield* Clock.currentTimeMillis;
            const produced = yield* Ref.make(false);
            const settle = Effect.gen(function* () {
              const closedAt = yield* Clock.currentTimeMillis;
              const healthy =
                (yield* Ref.get(produced)) &&
                closedAt - openedAt >= Duration.toMillis(HEALTHY_AFTER);
              const count = healthy ? 0 : (yield* Ref.get(failures)) + 1;
              yield* Ref.set(failures, count);
              yield* backoff(Math.max(0, count - 1));
            });
            return connectionEvents(connection).pipe(
              Stream.tap(() => Ref.set(produced, true)),
              Stream.concat(Stream.fromEffect(settle).pipe(Stream.drain)),
            );
          }),
        );
        return Stream.forever(attempt);
      }),
    );

  const cabinetKey = (value: ServerSettingsValue) =>
    JSON.stringify([value.cabinet.enabled, value.cabinet.baseUrl, value.cabinet.token]);

  // Subscribing before the snapshot keeps a change made between them.
  const bridge = Stream.unwrap(
    Effect.gen(function* () {
      const changes = yield* settings.subscribeChanges;
      const current = yield* settings.getSettings.pipe(Effect.orDie);
      return Stream.concat(Stream.make(current), changes);
    }),
  ).pipe(
    Stream.changesWith((left, right) => cabinetKey(left) === cabinetKey(right)),
    Stream.switchMap((value) =>
      !value.cabinet.enabled
        ? Stream.never
        : Stream.unwrap(
            toConnection(value.cabinet.baseUrl, value.cabinet.token).pipe(
              Effect.map(follow),
              Effect.orElseSucceed(() => Stream.never),
            ),
          ),
    ),
  );

  const events = yield* Stream.share(bridge, {
    capacity: 64,
    strategy: "sliding",
    idleTimeToLive: IDLE_TIME_TO_LIVE,
  });

  return CabinetService.of({
    status: status(),
    testConnection,
    listItems,
    getItem,
    getRaw,
    resolve,
    search,
    suggest,
    createItem,
    updateItem,
    addToProject,
    capture,
    fetchFile,
    events,
  });
});

export const layer = Layer.effect(CabinetService, make);
