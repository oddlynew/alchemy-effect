import { Effect } from "effect";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  TestLayer,
  runEffect,
  setupTestProject,
  teardownTestProject,
  getTestProject,
} from "./setup";
import { getV1ConnectionsById } from "../src/operations/getV1ConnectionsById";

describe("getV1ConnectionsById", () => {
  beforeAll(async () => {
    await Effect.runPromise(setupTestProject("conn-get"));
  }, 300_000);

  afterAll(async () => {
    await Effect.runPromise(teardownTestProject("conn-get"));
  }, 60_000);

  // ============================================================================
  // Happy path
  // ============================================================================

  it("happy path - gets a connection by id", { timeout: 30_000 }, async () => {
    const project = getTestProject("conn-get");
    const connectionId = project.defaultConnectionId!;

    const result = await runEffect(getV1ConnectionsById({ id: connectionId }));

    expect(result.data.id).toBe(connectionId);
    expect(result.data.name).toBeDefined();
    expect(result.data.kind).toBeDefined();
    expect(result.data.endpoints).toBeDefined();
    expect(result.data.database).toBeDefined();
    expect(result.data.database.id).toBe(project.databaseId);
  });

  // ============================================================================
  // Error tests
  // ============================================================================

  it(
    "error - NotFound for non-existent connection id",
    { timeout: 30_000 },
    async () => {
      await Effect.runPromise(
        getV1ConnectionsById({ id: "non-existent-conn-id-00000000" }).pipe(
          Effect.flip,
          Effect.map((e) => {
            expect(["NotFound", "UnprocessableEntity"]).toContain(
              (e as any)._tag,
            );
          }),
          Effect.provide(TestLayer),
        ),
      );
    },
  );

  it(
    "error - UnprocessableEntity for malformed id",
    { timeout: 30_000 },
    async () => {
      await Effect.runPromise(
        getV1ConnectionsById({ id: "" }).pipe(
          Effect.flip,
          Effect.map((e) => {
            expect(["UnprocessableEntity", "NotFound", "BadRequest"]).toContain(
              (e as any)._tag,
            );
          }),
          Effect.provide(TestLayer),
        ),
      );
    },
  );
});
