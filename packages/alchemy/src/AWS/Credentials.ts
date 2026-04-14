import {
  Credentials,
  fromAwsCredentialIdentity,
} from "@distilled.cloud/aws/Credentials";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { StageConfig } from "./StageConfig.ts";

export { Credentials } from "@distilled.cloud/aws/Credentials";

/**
 * If StageConfig provides static credentials, override the Credentials service.
 * Otherwise returns Layer.empty — Credentials must be provided by Auth.layer().
 */
export const fromStageConfig = () =>
  Layer.unwrap(
    Effect.serviceOption(StageConfig).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.map((config) => {
        if (config?.credentials) {
          return Layer.succeed(
            Credentials,
            Effect.succeed(fromAwsCredentialIdentity(config.credentials)),
          );
        }
        return Layer.empty;
      }),
    ),
  );
