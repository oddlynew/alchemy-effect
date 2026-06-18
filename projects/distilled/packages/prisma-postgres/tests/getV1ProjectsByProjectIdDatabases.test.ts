import { Effect } from "effect";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  TestLayer,
  runEffect,
  setupTestProject,
  teardownTestProject,
  getTestProject,
} from "./setup";
import { getV1ProjectsByProjectIdDatabases } from "../src/operations/getV1ProjectsByProjectIdDatabases";

describe("getV1ProjectsByProjectIdDatabases", () => {
  beforeAll(async () => {
    await Effect.runPromise(setupTestProject("proj-dbs"));
  }, 300_000);

  afterAll(async () => {
    await Effect.runPromise(teardownTestProject("proj-dbs"));
  }, 60_000);

  // ============================================================================
  // Happy path
  // ============================================================================

  it(
    "happy path - lists databases for a project",
    { timeout: 30_000 },
    async () => {
      const project = getTestProject("proj-dbs");

      const result = await runEffect(
        getV1ProjectsByProjectIdDatabases({ projectId: project.projectId }),
      );

      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
      expect(typeof result.pagination.hasMore).toBe("boolean");
      // The project was created with a database
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const db = result.data[0];
      expect(db.id).toBeDefined();
      expect(db.name).toBeDefined();
      expect(db.status).toBeDefined();
      expect(db.project.id).toBe(project.projectId);
    },
  );

  it("happy path - supports limit parameter", { timeout: 30_000 }, async () => {
    const project = getTestProject("proj-dbs");

    const result = await runEffect(
      getV1ProjectsByProjectIdDatabases({
        projectId: project.projectId,
        limit: 1,
      }),
    );

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeLessThanOrEqual(1);
  });

  // ============================================================================
  // Error tests
  // ============================================================================

  it(
    "error - NotFound for non-existent projectId",
    { timeout: 30_000 },
    async () => {
      await Effect.runPromise(
        getV1ProjectsByProjectIdDatabases({
          projectId: "non-existent-proj-id-00000000",
        }).pipe(
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
    "error - UnprocessableEntity for malformed projectId",
    { timeout: 30_000 },
    async () => {
      await Effect.runPromise(
        getV1ProjectsByProjectIdDatabases({ projectId: "" }).pipe(
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
