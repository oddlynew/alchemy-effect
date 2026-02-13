import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Instance } from "./Util/instance.ts";
import type { ExtractReq, WidenReq } from "./Util/requirements.ts";
import type { ExcludeAny } from "./Util/types.ts";

export type AnyService = STagClass<any, any, any>;

export type STagClass<
  Self,
  Tag extends string,
  Service,
  Data extends object = {},
> = Context.TagClass<Self, Tag, Service> &
  Data & {
    layer<
      Self,
      // @ts-expect-error
      Impl extends WidenReq<Self["Service"]>,
      Err = never,
      Req = never,
    >(
      this: Self,
      effect: Effect.Effect<Impl, Err, Req>,
    ): Layer.Layer<Instance<Self>, Err, ExcludeAny<ExtractReq<Impl>> | Req>;
  };

export const STag =
  <Tag extends string, Data extends object = {}>(tag: Tag, data?: Data) =>
  <Self, Service>(): STagClass<Self, Tag, Service, Data> =>
    Object.assign(Context.Tag(tag)<Self, Service>(), {
      ...data,
      layer(
        this: STagClass<Self, Tag, Service>,
        effect: Effect.Effect<any, any, any>,
      ) {
        return Layer.effect(this, effect);
      },
    }) as any;
