import { Effect } from "effect";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  TestLayer,
  runEffect,
  setupTestProject,
  teardownTestProject,
  getTestProject,
} from "./setup";
import { getV1WorkspacesById } from "../src/operations/getV1WorkspacesById";

describe("getV1WorkspacesById", () => {
  beforeAll(async () => {
    await Effect.runPromise(setupTestProject("ws-get"));
  }, 300_000);

  afterAll(async () => {
    await Effect.runPromise(teardownTestProject("ws-get"));
  }, 60_000);

  // ============================================================================
  // Happy path
  // ============================================================================

  it("happy path - gets a workspace by id", { timeout: 30_000 }, async () => {
    const project = getTestProject("ws-get");
    const workspaceId = project.workspaceId!;

    const result = await runEffect(getV1WorkspacesById({ id: workspaceId }));

    expect(result.data.id).toBe(workspaceId);
    expect(result.data.name).toBeDefined();
    expect(result.data.createdAt).toBeDefined();
    expect(result.data.url).toBeDefined();
  });

  // ============================================================================
  // Error tests
  // ============================================================================

  it(
    "error - NotFound for non-existent workspace id",
    { timeout: 30_000 },
    async () => {
      await Effect.runPromise(
        getV1WorkspacesById({ id: "non-existent-ws-id-00000000" }).pipe(
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
        getV1WorkspacesById({ id: "" }).pipe(
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
