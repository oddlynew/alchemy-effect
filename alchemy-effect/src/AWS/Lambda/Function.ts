import type { HttpClient } from "@effect/platform/HttpClient";
import type { Credentials } from "distilled-aws/Credentials";
import type { Region } from "distilled-aws/Region";
import * as Effect from "effect/Effect";

import type { Capability } from "../../Capability.ts";
import { Resource, type ResourceClass } from "../../Resource.ts";
import type { Bound, Unbound } from "../../SLayer.ts";
import * as IAM from "../IAM/index.ts";
import type * as AWS from "../index.ts";

export interface FunctionProps {
  functionName?: string;
  main: string;
  handler?: string;
  memory?: number;
  runtime?: "nodejs20.x" | "nodejs22.x";
  architecture?: "x86_64" | "arm64";
  url?: boolean;
  env?: {
    [key: string]: string;
  };
  policyStatements?: IAM.PolicyStatement[];
}

export interface Function<
  Id extends string,
  Props extends FunctionProps,
> extends Resource<"AWS.Lambda.Function", Id, Props> {
  functionArn: string;
  functionName: string;
  functionUrl: Props["url"] extends true ? string : undefined;
  roleName: string;
  roleArn: string;
  code: {
    hash: string;
  };
}

export interface FunctionClass<
  Self = any,
  Id extends string = string,
  Services = any,
> extends ResourceClass<Self, {}> {
  id: Id;
  services: Services[];
  props: FunctionProps;
}

export const Function =
  <Self>() =>
  <const Id extends string, Services = never>(
    id: Id,
    services?: Services[],
  ): FunctionClass<Self, Id, Services> =>
    Resource("AWS.Lambda.Function", id, {
      services,
    });

export type FunctionHandler = (
  event: any,
  ctx: AWS.Lambda.Context,
) => Promise<any>;

export const make: {
  <Props extends FunctionProps>(
    props: Props,
  ): <F, Err, Req extends Capability | Region | HttpClient | Credentials>(
    func: Effect.Effect<F, Err, Req>,
  ) => Unbound<Function<F, Props>, Err, Extract<Req, Capability>>;
} = Effect.gen(function* () {
  // loop through Context and identify entrypoints?
  // YUCK: would prefer it to be a general solution instead of hard-coded here
  const context = yield* Effect.context<never>();

  const func = Effect.fn(function* (event: any, context: AWS.Lambda.Context) {
    // identify services we have in this function and route requests to them
    for (const handler of interceptors) {
      if (handler.canHandle(event)) {
        return handler.handle(event);
      }
    }
  });

  for (const serviceTag of funcTag.services) {
    // this gets us the implementation but does not help us route
    const service = yield* RequestInterceptorLayer(serviceTag);
  }

  // Interceptor[]

  // export default ...
  return async (event: any, ctx: AWS.Lambda.Context) =>
    Effect.runPromise(func(event, ctx).pipe(Effect.provide(context)));
});
export const bind =
  <Caps extends Capability[]>(...bindings: Caps) =>
  <F, Err = never>(
    unbound: Unbound<F, Err, Caps[number]>,
  ): Bound<
    F,
    (event: any, ctx: AWS.Lambda.Context) => Promise<any>,
    Err,
    Caps[number]
  > =>
    undefined!;

export const run = (a: any) => {};
