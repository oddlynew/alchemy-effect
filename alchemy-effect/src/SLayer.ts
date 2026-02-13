import * as Layer from "effect/Layer";

import type { Types } from "effect";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { Pipeable } from "effect/Pipeable";
import type { IRuntime } from "./Runtime.ts";
import type { Instance } from "./Util/instance.ts";
import type { ExtractReq, WidenReq } from "./Util/requirements.ts";

export interface Unbound<in ROut, out E = never, in out Capabilities = never>
  extends Unbound.Variance<ROut, E, Capabilities>, Pipeable {}

export const UnboundTypeId: unique symbol = Symbol.for("alchemy/UnboundLayer");

export declare namespace Unbound {
  export interface Variance<
    in ROut,
    out E = never,
    out Req = never,
    in out Capabilities = never,
  > {
    readonly [UnboundTypeId]: {
      readonly _ROut: Types.Contravariant<ROut>;
      readonly _E: Types.Covariant<E>;
      readonly _Req: Types.Covariant<Req>;
      readonly _Capabilities: Types.Invariant<Capabilities>;
    };
  }
}

export const HostedTypeId: unique symbol = Symbol.for("alchemy/HostedLayer");

export interface Bound<
  F,
  in ROut,
  out E = never,
  in out Capabilities = never,
> {}

export declare namespace Bound {
  export interface Variance<
    F extends IRuntime,
    in ROut,
    out E = never,
    in out Capabilities = never,
  > {
    readonly [HostedTypeId]: {
      readonly _F: Types.Invariant<F>;
      readonly _ROut: Types.Contravariant<ROut>;
      readonly _E: Types.Covariant<E>;
      readonly _Capabilities: Types.Invariant<Capabilities>;
    };
  }
}

export declare const effect: {
  <I, S>(
    tag: Context.Tag<I, S>,
  ): <E, R, Impl extends WidenReq<S>>(
    effect: Effect.Effect<Impl, E, R>,
  ) => Layer.Layer<I, E, R | ExtractReq<Impl>>;

  <T extends Context.Tag<any, any>, Impl extends WidenReq<T["Service"]>, E, R>(
    tag: T,
    effect: Effect.Effect<Impl, E, R>,
  ): Layer.Layer<Instance<T>, E, R | ExtractReq<Impl>>;
};
