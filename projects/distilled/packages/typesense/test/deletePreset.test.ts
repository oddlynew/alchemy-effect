import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { deletePreset } from "../src/operations/deletePreset";
import { upsertPreset } from "../src/operations/upsertPreset";
import { runEffect, testRunId } from "./setup";

describe("deletePreset", () => {
  it(
    "deletes an existing preset and returns its name",
    { timeout: 30_000 },
    async () => {
      const presetId = `distilled-typesense-delpreset-${testRunId}`;

      const effect = Effect.gen(function* () {
        yield* upsertPreset({
          presetId,
          value: {
            searches: [
              {
                collection: "products",
                q: "shoe",
                query_by: "name",
              },
            ],
          },
        });

        const result = yield* deletePreset({ presetId });
        expect(result.name).toBe(presetId);
      });

      await runEffect(effect);
    },
  );

  it(
    "fails with NotFound when the preset does not exist",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        deletePreset({
          presetId: `does-not-exist-${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect((error as { _tag: string })._tag).toBe("NotFound");
    },
  );
});
