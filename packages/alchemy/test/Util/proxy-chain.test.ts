import { proxyChain, proxyChainPromise } from "@/Util/proxy-chain";
import * as Effect from "effect/Effect";
import { describe, expect, test } from "vitest";

describe("proxyChain", () => {
  test("replays a get+call chain against an Effect-returning target", async () => {
    const target = {
      select() {
        return { from: (t: string) => Effect.succeed(`rows:${t}`) };
      },
    };
    const db = proxyChain<typeof target>(Effect.succeed(target));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* db
          .select()
          .from("users") as unknown as Effect.Effect<string>;
      }),
    );
    expect(result).toBe("rows:users");
  });
});

describe("proxyChainPromise", () => {
  test("wraps a thenable (Promise) result in an Effect", async () => {
    const target = {
      select() {
        return { from: (t: string) => Promise.resolve(`rows:${t}`) };
      },
    };
    const db = proxyChainPromise<typeof target>(Effect.succeed(target));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* db
          .select()
          .from("users") as unknown as Effect.Effect<string>;
      }),
    );
    expect(result).toBe("rows:users");
  });

  test("maps a rejected promise into the Effect error channel", async () => {
    const boom = new Error("boom");
    const target = { run: () => Promise.reject(boom) };
    const db = proxyChainPromise<typeof target, Error>(
      Effect.succeed(target),
      (cause) => cause as Error,
    );
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* db.run() as unknown as Effect.Effect<never, Error>;
      }),
    );
    expect(exit._tag).toBe("Failure");
  });

  test("passes a non-thenable (Effect) result through unchanged", async () => {
    const target = { value: Effect.succeed(42) };
    const db = proxyChainPromise<typeof target>(Effect.succeed(target));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* db.value as unknown as Effect.Effect<number>;
      }),
    );
    expect(result).toBe(42);
  });
});
