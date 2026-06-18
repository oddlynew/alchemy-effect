import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createCollection } from "../src/operations/createCollection";
import { deleteCollection } from "../src/operations/deleteCollection";
import { updateCollection } from "../src/operations/updateCollection";
import { runEffect, testRunId } from "./setup";

describe("updateCollection", () => {
  it(
    "adds a new field to a collection's schema",
    { timeout: 30_000 },
    async () => {
      const collectionName = `distilled-typesense-updcol-${testRunId}`;

      const effect = Effect.gen(function* () {
        yield* createCollection({
          name: collectionName,
          fields: [{ name: "title", type: "string" }],
        });

        const result = yield* updateCollection({
          collectionName,
          fields: [{ name: "year", type: "int32" }],
        });

        expect(Array.isArray(result.fields)).toBe(true);
        const yearField = result.fields.find((f) => f.name === "year");
        expect(yearField).toBeDefined();
        expect(yearField?.type).toBe("int32");
      }).pipe(
        Effect.ensuring(
          deleteCollection({ collectionName }).pipe(Effect.ignore),
        ),
      );

      await runEffect(effect);
    },
  );

  it(
    "fails with BadRequest when the update body has an invalid field type",
    { timeout: 30_000 },
    async () => {
      const collectionName = `distilled-typesense-updcol-bad-${testRunId}`;

      const effect = Effect.gen(function* () {
        yield* createCollection({
          name: collectionName,
          fields: [{ name: "title", type: "string" }],
        });

        // "not-a-real-type" isn't a valid Typesense field type, so the
        // server returns 400 with a message explaining the invalid type.
        const error = yield* updateCollection({
          collectionName,
          fields: [{ name: "broken", type: "not-a-real-type" }],
        }).pipe(Effect.flip);

        expect((error as { _tag: string })._tag).toBe("BadRequest");
      }).pipe(
        Effect.ensuring(
          deleteCollection({ collectionName }).pipe(Effect.ignore),
        ),
      );

      await runEffect(effect);
    },
  );

  it(
    "fails with NotFound when the collection does not exist",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        updateCollection({
          collectionName: `does-not-exist-${testRunId}`,
          fields: [{ name: "year", type: "int32" }],
        }).pipe(Effect.flip),
      );

      expect((error as { _tag: string })._tag).toBe("NotFound");
    },
  );
});
