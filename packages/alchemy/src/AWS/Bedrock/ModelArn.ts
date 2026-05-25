import type { AccountID, RegionID } from "../Environment.ts";

/**
 * Resolve a Bedrock model identifier into the full set of IAM Resource ARNs
 * required to invoke it.
 *
 * Accepted shapes:
 *
 * - `arn:aws:bedrock:...` — used verbatim
 * - `us.anthropic.claude-3-5-sonnet-20240620-v1:0` (cross-region inference
 *   profile id with a two-letter geographic prefix) — expanded to both an
 *   `inference-profile/` ARN in the caller's account AND a wildcard
 *   `foundation-model/` ARN for the underlying model (Bedrock requires
 *   permission on both when invoking via an inference profile)
 * - any other string — treated as a foundation-model id and expanded to
 *   `arn:aws:bedrock:${region}::foundation-model/${modelId}`
 */
export const resolveModelArns = ({
  modelId,
  region,
  accountId,
}: {
  modelId: string;
  region: RegionID;
  accountId: AccountID;
}): string[] => {
  if (modelId.startsWith("arn:")) return [modelId];
  const inferenceProfilePrefix = /^(us|eu|apac|us-gov|ap)\.[^.]+\./.exec(
    modelId,
  );
  if (inferenceProfilePrefix) {
    const foundationModelId = modelId.substring(modelId.indexOf(".") + 1);
    return [
      `arn:aws:bedrock:${region}:${accountId}:inference-profile/${modelId}`,
      `arn:aws:bedrock:*::foundation-model/${foundationModelId}`,
    ];
  }
  return [`arn:aws:bedrock:${region}::foundation-model/${modelId}`];
};
