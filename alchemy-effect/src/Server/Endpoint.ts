import type { HttpServerRequest } from "@effect/platform/HttpServerRequest";
import type { HttpServerResponse } from "@effect/platform/HttpServerResponse";
import * as Effect from "effect/Effect";
import type { ContentType } from "../ContentType.ts";
import { STag, type STagClass } from "../STag.ts";
import type * as Route from "./Operation.ts";
import type { Protocol } from "./Protocol.ts";

export interface EndpointService {
  fetch: (request: HttpServerRequest) => Effect.Effect<HttpServerResponse>;
}

export interface EndpointClass<
  Name extends string = any,
  Routes extends readonly Route.AnyOperation[] = any,
  Protocols extends Protocol[] = any,
  Accepts extends ContentType[] = any,
> extends STagClass<
  EndpointClass<Name, Routes, Protocols, Accepts>,
  `Endpoint<${Name}>`,
  EndpointService,
  {
    routes: Routes;
    protocols: Protocols;
    accepts: Accepts;
  }
> {
  readonly routes: Routes;
  readonly protocols: Protocols;
  readonly accepts: Accepts;
}

export const Endpoint = <
  Name extends string,
  const Routes extends readonly Route.AnyOperation[],
  const Protocols extends Protocol[],
  const Accepts extends ContentType[],
>(
  name: Name,
  props: {
    routes: Routes;
    protocols: Protocols;
    accepts: Accepts;
  },
): EndpointClass<Name, Routes, Protocols, Accepts> =>
  STag(name, {
    routes: props.routes,
    protocols: props.protocols,
    accepts: props.accepts,
  })<EndpointClass<Name, Routes, Protocols, Accepts>, EndpointService>() as any;
