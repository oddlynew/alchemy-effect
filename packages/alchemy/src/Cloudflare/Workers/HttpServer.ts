import type * as cf from "@cloudflare/workers-types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import type { HttpBodyError } from "effect/unstable/http/HttpBody";
import * as EffectHttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Http from "../../Http.ts";
import { Request } from "./Request.ts";
import {
  isWorkerEvent,
  WorkerExecutionContext,
  type WorkerServices,
} from "./Worker.ts";

export type HttpEffect = Http.HttpEffect<WorkerServices>;

export const makeRequestHandler = <Req = never>(
  httpEffect: Http.HttpEffect<Req> | Effect.Effect<Http.HttpEffect<Req>>,
) => {
  const safeHttpEffect = Http.makeSafeHttpEffect(httpEffect);
  return (event: Request) =>
    isWorkerEvent(event) && event.type === "fetch"
      ? makeRequestEffect(event.input, safeHttpEffect, {
          remoteAddress:
            event.input.headers.get("cf-connecting-ip") ?? undefined,
        })
      : undefined;
};

// effect's `scopeTransferToStream` brands a `Scope` with this marker to
// signal: "I'm transferring ownership to a streaming response body —
// please don't close me, my `Stream.onExit` will." Global symbol so
// it's stable across module copies.
const scopeEjectedSymbol = Symbol.for("effect/http/HttpEffect/scopeEjected");

export const makeRequestEffect = <Req = never>(
  webRequest: cf.Request,
  handler: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError.HttpServerError | HttpBodyError,
    Req
  >,
  options: {
    // Preserve transport metadata when this helper is adapting a request
    // that originated from another runtime surface.
    remoteAddress?: string;
    // Durable Objects need to register the accepted socket on object state
    // instead of calling `server.accept()` directly.
    acceptWebSocket?: (socket: cf.WebSocket) => void;
  } = {},
): Effect.Effect<
  Response,
  never,
  Exclude<Req, HttpServerRequest.HttpServerRequest | Scope.Scope>
> =>
  Effect.gen(function* () {
    const request = HttpServerRequest.fromWeb(
      webRequest as any as globalThis.Request,
    ).modify({
      remoteAddress: Option.fromUndefinedOr(options.remoteAddress),
    });

    Object.defineProperty(request, "raw", {
      get: () =>
        Object.assign(request.stream, {
          raw: webRequest.body,
        }),
    });
    const handlerScope = Scope.makeUnsafe();

    const response = yield* handler.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(HttpServerRequest.HttpServerRequest, request),
          Layer.succeed(Request, webRequest as any),
        ),
      ),
      Scope.provide(handlerScope),
      Effect.catchCause((cause) => {
        // eslint-disable-next-line no-console
        console.log("[serveWebRequest] cause:", Cause.pretty(cause));
        const message = Option.match(Cause.findErrorOption(cause), {
          onNone: () => "Internal Server Error",
          onSome: (error) =>
            error instanceof Error && error.message
              ? error.message
              : "Internal Server Error",
        });
        return Effect.succeed(
          HttpServerResponse.text(message, {
            status: 500,
            statusText: message,
          }),
        );
      }),
    );

    const finalResponse = EffectHttpEffect.scopeTransferToStream(response);
    const webResponse = HttpServerResponse.toWeb(finalResponse, {
      context: yield* Effect.context(),
    });
    if (!(scopeEjectedSymbol in handlerScope)) {
      const executionContext = yield* Effect.serviceOption(
        WorkerExecutionContext,
      );
      const close = Effect.runPromise(Scope.close(handlerScope, Exit.void));
      if (Option.isSome(executionContext)) {
        executionContext.value.waitUntil(close);
      }
      // If no execution context is provided (e.g. some test harnesses),
      // fall through — the promise is already running; we just don't
      // hold the worker open for it.
    }

    return webResponse;
  }) as any;
