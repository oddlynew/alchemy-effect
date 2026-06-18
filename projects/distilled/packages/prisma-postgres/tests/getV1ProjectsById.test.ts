import { Effect } from "effect";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  TestLayer,
  runEffect,
  setupTestProject,
  teardownTestProject,
  getTestProject,
} from "./setup";
import { getV1ProjectsById } from "../src/operations/getV1ProjectsById";

describe("getV1ProjectsById", () => {
  beforeAll(async () => {
    await Effect.runPromise(setupTestProject("proj-get"));
  }, 300_000);

  afterAll(async () => {
    await Effect.runPromise(teardownTestProject("proj-get"));
  }, 60_000);

  // ============================================================================
  // Happy path
  // ============================================================================

  it("happy path - gets a project by id", { timeout: 30_000 }, async () => {
    const project = getTestProject("proj-get");

    const result = await runEffect(
      getV1ProjectsById({ id: project.projectId }),
    );

    expect(result.data.id).toBe(project.projectId);
    expect(result.data.name).toBe(project.projectName);
    expect(result.data.workspace).toBeDefined();
    expect(result.data.workspace.id).toBeDefined();
  });

  // ============================================================================
  // Error tests
  // ============================================================================

  it(
    "error - NotFound for non-existent project id",
    { timeout: 30_000 },
    async () => {
      await Effect.runPromise(
        getV1ProjectsById({ id: "non-existent-proj-id-00000000" }).pipe(
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
        getV1ProjectsById({ id: "" }).pipe(
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
