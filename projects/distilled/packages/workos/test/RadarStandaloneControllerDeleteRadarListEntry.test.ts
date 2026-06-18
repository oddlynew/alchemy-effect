import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RadarStandaloneControllerDeleteRadarListEntry } from "../src/operations/RadarStandaloneControllerDeleteRadarListEntry.ts";
import { RadarStandaloneControllerUpdateRadarList } from "../src/operations/RadarStandaloneControllerUpdateRadarList.ts";
import { runEffect, testRunId } from "./setup.ts";

describe("RadarStandaloneControllerDeleteRadarListEntry", () => {
  it("removes an entry from a Radar list", { timeout: 60_000 }, async () => {
    const entry = `distilled-radar-delete-${testRunId}@example.com`;
    const error = await runEffect(
      Effect.gen(function* () {
        yield* RadarStandaloneControllerUpdateRadarList({
          type: "email",
          action: "block",
          entry,
        });
        yield* RadarStandaloneControllerDeleteRadarListEntry({
          type: "email",
          action: "block",
          entry,
        });
        return yield* RadarStandaloneControllerDeleteRadarListEntry({
          type: "email",
          action: "block",
          entry,
        });
      }).pipe(Effect.flip),
    );
    expect(error._tag).toBe("NotFound");
  });

  it(
    "fails with NotFound for a non-existent entry",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        RadarStandaloneControllerDeleteRadarListEntry({
          type: "email",
          action: "block",
          entry: `distilled-radar-missing-${testRunId}@example.com`,
        }).pipe(Effect.flip),
      );
      expect(error._tag).toBe("NotFound");
    },
  );

  it(
    "fails with BadRequest for a malformed ip_address entry",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        RadarStandaloneControllerDeleteRadarListEntry({
          type: "ip_address",
          action: "block",
          entry: `not-an-ip-${testRunId}`,
        }).pipe(Effect.flip),
      );
      expect(error._tag).toBe("BadRequest");
    },
  );
});
