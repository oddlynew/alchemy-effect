import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { StageConfig } from "./StageConfig.ts";

export type AccountID = string;

export class Account extends Context.Service<Account, AccountID>()(
  "AWS::AccountID",
) {}

export const fromStageConfig = () =>
  Layer.effect(
    Account,
    Effect.gen(function* () {
      const config = yield* Effect.serviceOption(StageConfig).pipe(
        Effect.map(Option.getOrUndefined),
      );
      if (config?.account) {
        return config.account;
      }
      return yield* Effect.die(
        "AWS account ID not found. Configure via: alchemy-effect login --configure",
      );
    }),
  );
