import type { Types } from "effect";
import type { Pipeable } from "effect/Pipeable";

import { Resource } from "./Resource.ts";

export const EnvironmentTypeId = "alchemy/Environment";

export interface EnvironmentProps<Services = never> {
  services: Services[];
}

export type EnvironmentClass<
  Fn extends (...args: any[]) => any = (...args: any[]) => any,
> = Fn & {
  readonly type: ReturnType<Fn>["type"];
};

export interface Environment<
  Class extends Resource<any, any, any, any>,
  out Req = never,
  in out Capabilities = never,
  out Deps extends Resource = never,
>
  extends Environment.Variance<Class, Req, Capabilities, Deps>, Pipeable {
  readonly class: Class;
  [Symbol.iterator](): ReturnType<this["class"][typeof Symbol.iterator]>;
}

export const Environment = Resource;

export declare namespace Environment {
  export interface Variance<Class, Req, Capabilities, Deps> {
    readonly [EnvironmentTypeId]: {
      readonly _Class: Types.Covariant<Class>;
      readonly _Req: Types.Covariant<Req>;
      readonly _Capabilities: Types.Invariant<Capabilities>;
      readonly _Deps: Types.Covariant<Deps>;
    };
  }
}
