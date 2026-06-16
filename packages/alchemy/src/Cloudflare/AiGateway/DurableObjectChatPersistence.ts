import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Chat from "effect/unstable/ai/Chat";
import {
  BackingPersistence,
  PersistenceError,
  type BackingPersistenceStore,
} from "effect/unstable/persistence/Persistence";
import { DurableObjectState } from "../Workers/DurableObjectState.ts";

export const DurableObjectChatPersistence = Layer.effect(BackingPersistence)(
  Effect.gen(function* () {
    const state = yield* DurableObjectState;
    const storage = state.storage;

    const wrapErr = (op: string, key?: string) => (cause: unknown) =>
      new PersistenceError({
        message: `Failed to ${op}${key !== undefined ? ` key ${key}` : ""} in DurableObject storage`,
        cause,
      });

    return BackingPersistence.of({
      make: (storeId) =>
        Effect.sync(() => {
          const prefixed = (k: string) => `${storeId}:${k}`;
          return {
            get: (key) =>
              storage
                .get<object>(prefixed(key))
                .pipe(Effect.mapError(wrapErr("get", key))),
            getMany: (keys) =>
              storage.get<object>(keys.map(prefixed)).pipe(
                Effect.mapError(wrapErr("getMany")),
                Effect.map(
                  (map) =>
                    keys.map((k) => map.get(prefixed(k))) as Arr.NonEmptyArray<
                      object | undefined
                    >,
                ),
              ),
            set: (key, value, _ttl) =>
              storage
                .put(prefixed(key), value)
                .pipe(Effect.mapError(wrapErr("set", key))),
            setMany: (entries) =>
              storage
                .put(
                  Object.fromEntries(entries.map(([k, v]) => [prefixed(k), v])),
                )
                .pipe(Effect.mapError(wrapErr("setMany"))),
            remove: (key) =>
              storage
                .delete(prefixed(key))
                .pipe(Effect.asVoid, Effect.mapError(wrapErr("remove", key))),
            clear: storage.list({ prefix: `${storeId}:` }).pipe(
              Effect.flatMap((map) => {
                const ks = [...map.keys()];
                if (ks.length === 0) return Effect.void;
                return Effect.asVoid(storage.delete(ks));
              }),
              Effect.mapError(wrapErr("clear")),
            ),
          } satisfies BackingPersistenceStore;
        }),
    });
  }),
);

export const layerChatDurableObject = Chat.layerPersisted({
  storeId: "alchemy.chat",
}).pipe(Layer.provide(DurableObjectChatPersistence));
