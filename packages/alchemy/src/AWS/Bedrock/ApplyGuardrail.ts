import * as bedrockRuntime from "@distilled.cloud/aws/bedrock-runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../../Binding.ts";
import * as Output from "../../Output.ts";
import { isFunction } from "../Lambda/Function.ts";
import type { Guardrail } from "./Guardrail.ts";

export interface ApplyGuardrailRequest extends Omit<
  bedrockRuntime.ApplyGuardrailRequest,
  "guardrailIdentifier" | "guardrailVersion"
> {
  /**
   * Guardrail version to apply. Defaults to the `DRAFT` version managed by
   * Alchemy. Pass a numbered version string (e.g. `"1"`) to apply a published
   * version instead.
   * @default "DRAFT"
   */
  guardrailVersion?: string;
}

export class ApplyGuardrail extends Binding.Service<
  ApplyGuardrail,
  (
    guardrail: Guardrail,
  ) => Effect.Effect<
    (
      request: ApplyGuardrailRequest,
    ) => Effect.Effect<
      bedrockRuntime.ApplyGuardrailResponse,
      bedrockRuntime.ApplyGuardrailError
    >
  >
>()("AWS.Bedrock.ApplyGuardrail") {}

export const ApplyGuardrailLive = Layer.effect(
  ApplyGuardrail,
  Effect.gen(function* () {
    const Policy = yield* ApplyGuardrailPolicy;
    const applyGuardrail = yield* bedrockRuntime.applyGuardrail;

    return Effect.fn(function* (guardrail: Guardrail) {
      const GuardrailIdentifier = yield* guardrail.guardrailId;
      yield* Policy(guardrail);
      return Effect.fn(function* (request: ApplyGuardrailRequest) {
        return yield* applyGuardrail({
          ...request,
          guardrailIdentifier: yield* GuardrailIdentifier,
          guardrailVersion: request.guardrailVersion ?? "DRAFT",
        });
      });
    });
  }),
);

export class ApplyGuardrailPolicy extends Binding.Policy<
  ApplyGuardrailPolicy,
  (guardrail: Guardrail) => Effect.Effect<void>
>()("AWS.Bedrock.ApplyGuardrail") {}

export const ApplyGuardrailPolicyLive = ApplyGuardrailPolicy.layer.succeed(
  Effect.fn(function* (host, guardrail) {
    if (isFunction(host)) {
      yield* host.bind`Allow(${host}, AWS.Bedrock.ApplyGuardrail(${guardrail}))`(
        {
          policyStatements: [
            {
              Effect: "Allow",
              Action: ["bedrock:ApplyGuardrail"],
              Resource: [Output.interpolate`${guardrail.guardrailArn}`],
            },
          ],
        },
      );
    } else {
      return yield* Effect.die(
        `ApplyGuardrailPolicy does not support runtime '${host.Type}'`,
      );
    }
  }),
);
