import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as AI from "../../Agent/index.ts";
import type { DurableObjectServices } from "../Workers/DurableObjectNamespace.ts";

export interface Agent<
  Name extends string,
  Refs extends any[],
  Self,
> extends AI.Agent<Name, Refs, Self> {
  <
    Eff extends Effect.Effect<any, any, any>,
    AReq extends DurableObjectServices,
  >(
    f: (
      this: Layer.Layer<Self, never, AI.Services<Refs>>,
    ) => Generator<Eff, Layer.Layer<never, never, AReq>, never>,
  ): Effect.Effect<
    Layer.Layer<Self, never, DurableObjectServices>,
    [Eff] extends [never]
      ? never
      : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>]
        ? E
        : never,
    [Eff] extends [never]
      ? never
      : [Eff] extends [Effect.Effect<infer _A, infer _E, infer R>]
        ? R
        : never
  > & {
    new (): {};
  };
  layer<
    Eff extends Effect.Effect<any, any, any>,
    AReq extends DurableObjectServices,
  >(
    f: (
      this: Layer.Layer<Self, never, AI.Services<Refs>>,
    ) => Generator<Eff, Layer.Layer<never, never, AReq>, never>,
  ): Layer.Layer<
    Self,
    [Eff] extends [never]
      ? never
      : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>]
        ? E
        : never,
    DurableObjectServices | [Eff] extends [never]
      ? never
      : [Eff] extends [Effect.Effect<infer _A, infer _E, infer R>]
        ? R
        : never
  >;
}

export declare const Agent: {
  <Self>(): {
    <Name extends string>(
      id: Name,
    ): {
      <const Refs extends any[]>(
        template: TemplateStringsArray,
        ...refs: Refs
      ): Agent<Name, Refs, Self>;
    };
  };
};
