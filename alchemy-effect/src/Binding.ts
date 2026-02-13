import * as Effect from "effect/Effect";
import type { Capability, Satisfied } from "./Capability.ts";
import type { Environment, EnvironmentClass } from "./Environment.ts";

export interface Binding<Cap extends Capability, Props extends object> {
  capability: Cap;
  props: Props;
}

export const Binding = <
  Fn extends (target: any, props?: any) => Binding<Capability, any>,
>(
  tag: string,
  fn: Fn,
): Fn & {
  Tag: string;
} => Object.assign(fn, { Tag: tag });

export interface BindingFn<
  Tag extends string = string,
  Fn extends (...args: any[]) => any = any,
> {
  tag: `${Tag}`;
  fn: Fn;
  new (): BindingFn<Tag, Fn>;
}

export const fn = <
  Tag extends string,
  Fn extends (...args: any[]) => Effect.Effect<void, any, any>,
>(
  tag: Tag,
  fn: Fn,
): BindingFn<Tag, Fn> => class {};

export const call = <B extends BindingFn>(tag: B["tag"]): B["fn"] => undefined!;

export const satisfy =
  <Cap extends Capability>() =>
  <Env extends EnvironmentClass<any, any>>(
    env: Env,
    props: Environment.BindingProps<Env>,
  ): Effect.Effect<void, never, Satisfied<Cap>> =>
    undefined!;
