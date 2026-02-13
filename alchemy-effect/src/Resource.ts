import type { Environment } from "./Environment.ts";

export interface ResourceClass<
  Type extends ResourceClass = any,
  Props extends any = any,
  Req = any,
> extends Environment<Type, Props, never, Req> {
  type: Type;
  /** @internal */
  props: Props;
  new (): Resource<Type, Props>;
}

export interface Resource<Type, Props extends any> {
  type: Type;
  id: Id;
  props: Props;
}

export const Resource = <
  const Type extends string,
  const Id extends string,
  const Props extends any = never,
>(
  type: Type,
  id: Id,
  props?: Props,
): ResourceClass<Type, Id, Props> => undefined!;
