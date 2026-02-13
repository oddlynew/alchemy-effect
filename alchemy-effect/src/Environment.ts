import type { Types } from "effect";
import type { Pipeable } from "effect/Pipeable";

export const EnvironmentTypeId = "alchemy/InfraLayer";

export interface Environment<
  in out Class,
  in out Req = never,
  in out Capabilities = never,
>
  extends Environment.Variance<Class, Req, Capabilities>, Pipeable {
  readonly class: Class;
}

export declare namespace Environment {
  export type Any = Environment<any, any, any>;
  export interface Variance<
    in out Class,
    in out Req = never,
    in out Capabilities = never,
  > {
    readonly [EnvironmentTypeId]: {
      readonly _Class: Types.Invariant<Class>;
      readonly _Req: Types.Invariant<Req>;
      readonly _Capabilities: Types.Invariant<Capabilities>;
    };
  }

  export type BindingProps<Env extends EnvironmentClass<any, any>> =
    // @ts-expect-error
    ReturnType<Env>["binding"];
}

export interface EnvironmentProps<Services = never> {
  services: Services[];
}

export type EnvironmentClass<
  Tag extends string = string,
  Fn extends (...args: any[]) => any = (...args: any[]) => any,
> = Fn & {
  readonly type: Tag;
};

export const make = <
  const Tag extends string,
  Fn extends (...args: any[]) => any,
>(
  tag: Tag,
  fn: Fn,
): EnvironmentClass<Tag, Fn> => Object.assign(fn, { type: tag });
