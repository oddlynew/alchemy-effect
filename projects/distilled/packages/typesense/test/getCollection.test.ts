import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createCollection } from "../src/operations/createCollection";
import { deleteCollection } from "../src/operations/deleteCollection";
import { getCollection } from "../src/operations/getCollection";
import { runEffect, testRunId } from "./setup";

describe("getCollection", () => {
  it(
    "retrieves an existing collection's metadata",
    { timeout: 30_000 },
    async () => {
      const collectionName = `distilled-typesense-getcol-${testRunId}`;

      const effect = Effect.gen(function* () {
        yield* createCollection({
          name: collectionName,
          fields: [
            { name: "title", type: "string" },
            { name: "year", type: "int32", facet: true },
          ],
        });

        const result = yield* getCollection({ collectionName });
        expect(result.name).toBe(collectionName);
        expect(result.fields.map((f) => f.name)).toEqual(["title", "year"]);
        expect(typeof result.num_documents).toBe("number");
        expect(typeof result.created_at).toBe("number");
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
        getCollection({
          collectionName: `does-not-exist-${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect((error as { _tag: string })._tag).toBe("NotFound");
    },
  );
});
