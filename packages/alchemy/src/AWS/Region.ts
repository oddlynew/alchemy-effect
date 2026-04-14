import * as Region from "@distilled.cloud/aws/Region";
import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { StageConfig } from "./StageConfig.ts";

export { Region } from "@distilled.cloud/aws/Region";

export type RegionID = string;

export const of = (region: string) => Layer.succeed(Region.Region, region);

export class EnvironmentVariableNotSet extends Data.TaggedError(
  "EnvironmentVariableNotSet",
)<{
  message: string;
  variable: string;
}> {}

export const fromEnv = () =>
  Layer.effect(
    Region.Region,
    Effect.gen(function* () {
      const region = yield* Config.option(Config.string("AWS_REGION")).pipe(
        Config.map(Option.getOrUndefined),
      );
      if (!region) {
        return yield* Effect.fail(
          new EnvironmentVariableNotSet({
            message: "AWS_REGION is not set",
            variable: "AWS_REGION",
          }),
        );
      }
      return region;
    }),
  );

export const fromStageConfig = () =>
  Layer.effect(
    Region.Region,
    Effect.gen(function* () {
      const config = yield* Effect.serviceOption(StageConfig).pipe(
        Effect.map(Option.getOrUndefined),
      );
      if (config?.region) {
        return config.region;
      }
      return yield* Effect.die(
        "AWS region not found. Configure via: alchemy-effect login --configure",
      );
    }),
  );
