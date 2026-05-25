import * as bedrock from "@distilled.cloud/aws/bedrock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../../Diff.ts";
import { createPhysicalName } from "../../PhysicalName.ts";
import * as Provider from "../../Provider.ts";
import { Resource } from "../../Resource.ts";
import { createInternalTags, diffTags } from "../../Tags.ts";
import type { Providers } from "../Providers.ts";

export type GuardrailId = string;
export type GuardrailArn = string;

export interface GuardrailProps {
  /**
   * Name of the guardrail. If omitted, a unique name is generated from the
   * app, stage, and logical ID.
   */
  name?: string;
  /**
   * Description of the guardrail.
   */
  description?: string;
  /**
   * Message returned to the caller when the guardrail blocks an input.
   * @default "Sorry, the input was blocked."
   */
  blockedInputMessaging?: string;
  /**
   * Message returned to the caller when the guardrail blocks the model's output.
   * @default "Sorry, the model's response was blocked."
   */
  blockedOutputsMessaging?: string;
  /**
   * Topic policy — list of denied topics.
   */
  topicPolicyConfig?: bedrock.GuardrailTopicPolicyConfig;
  /**
   * Content policy — filters for harmful content categories such as hate,
   * insults, sexual, violence, misconduct, and prompt-attack.
   */
  contentPolicyConfig?: bedrock.GuardrailContentPolicyConfig;
  /**
   * Word policy — list of denied words and managed word lists (e.g. profanity).
   */
  wordPolicyConfig?: bedrock.GuardrailWordPolicyConfig;
  /**
   * Sensitive information policy — PII entities and regex patterns to block
   * or anonymize.
   */
  sensitiveInformationPolicyConfig?: bedrock.GuardrailSensitiveInformationPolicyConfig;
  /**
   * Contextual grounding policy — score-based filter that detects ungrounded
   * or irrelevant model responses.
   */
  contextualGroundingPolicyConfig?: bedrock.GuardrailContextualGroundingPolicyConfig;
  /**
   * Automated reasoning policy — formal-logic checks for factual correctness.
   */
  automatedReasoningPolicyConfig?: bedrock.GuardrailAutomatedReasoningPolicyConfig;
  /**
   * Cross-region inference configuration.
   */
  crossRegionConfig?: bedrock.GuardrailCrossRegionConfig;
  /**
   * KMS key used to encrypt the guardrail.
   */
  kmsKeyId?: string;
  /**
   * User-defined tags for the guardrail.
   */
  tags?: Record<string, string>;
}

export interface Guardrail extends Resource<
  "AWS.Bedrock.Guardrail",
  GuardrailProps,
  {
    guardrailId: GuardrailId;
    guardrailArn: GuardrailArn;
    guardrailName: string;
    version: string;
    status: bedrock.GuardrailStatus;
  },
  never,
  Providers
> {}

/**
 * An Amazon Bedrock guardrail that filters user inputs and model responses
 * against configured policies (topics, content filters, denied words, PII,
 * grounding, and automated reasoning).
 *
 * The DRAFT version is managed by Alchemy. Publish numbered versions for
 * production traffic via `createGuardrailVersion` from the AWS SDK.
 *
 * @section Creating a Guardrail
 * @example Block harmful content
 * ```typescript
 * import * as Bedrock from "alchemy/AWS/Bedrock";
 *
 * const guardrail = yield* Bedrock.Guardrail("ContentGuardrail", {
 *   contentPolicyConfig: {
 *     filtersConfig: [
 *       { type: "HATE", inputStrength: "HIGH", outputStrength: "HIGH" },
 *       { type: "VIOLENCE", inputStrength: "HIGH", outputStrength: "HIGH" },
 *     ],
 *   },
 * });
 * ```
 *
 * @example Block sensitive PII
 * ```typescript
 * const guardrail = yield* Bedrock.Guardrail("PiiGuardrail", {
 *   sensitiveInformationPolicyConfig: {
 *     piiEntitiesConfig: [
 *       { type: "EMAIL", action: "ANONYMIZE" },
 *       { type: "US_SOCIAL_SECURITY_NUMBER", action: "BLOCK" },
 *     ],
 *   },
 * });
 * ```
 *
 * @section Applying a Guardrail at Runtime
 * @example Apply guardrail to user content
 * ```typescript
 * // init
 * const applyGuardrail = yield* Bedrock.ApplyGuardrail.bind(guardrail);
 *
 * // runtime
 * const result = yield* applyGuardrail({
 *   source: "INPUT",
 *   content: [{ text: { text: userMessage } }],
 * });
 * if (result.action === "GUARDRAIL_INTERVENED") {
 *   return HttpServerResponse.text("Blocked", { status: 400 });
 * }
 * ```
 */
export const Guardrail = Resource<Guardrail>("AWS.Bedrock.Guardrail");

const DEFAULT_BLOCKED_INPUT = "Sorry, the input was blocked.";
const DEFAULT_BLOCKED_OUTPUT = "Sorry, the model's response was blocked.";

class GuardrailNotReady extends Data.TaggedError("GuardrailNotReady")<{
  readonly status: bedrock.GuardrailStatus;
}> {}

const unredact = (
  value: string | Redacted.Redacted<string> | undefined,
): string | undefined =>
  value === undefined
    ? undefined
    : typeof value === "string"
      ? value
      : Redacted.value(value);

const toTagRecord = (tags: bedrock.Tag[] | undefined): Record<string, string> =>
  Object.fromEntries((tags ?? []).map((tag) => [tag.key, tag.value]));

export const GuardrailProvider = () =>
  Provider.effect(
    Guardrail,
    Effect.gen(function* () {
      const createGuardrailName = (id: string, props: GuardrailProps) =>
        props.name
          ? Effect.succeed(props.name)
          : createPhysicalName({ id, maxLength: 50 });

      const findGuardrailByName = Effect.fn(function* (name: string) {
        let nextToken: string | undefined;
        do {
          const page = yield* bedrock.listGuardrails({
            maxResults: 100,
            nextToken,
          });
          const match = (page.guardrails ?? []).find(
            (g) => unredact(g.name) === name,
          );
          if (match) return match;
          nextToken = page.nextToken;
        } while (nextToken);
        return undefined;
      });

      const readGuardrail = Effect.fn(function* (guardrailIdentifier: string) {
        return yield* bedrock
          .getGuardrail({ guardrailIdentifier })
          .pipe(
            Effect.catchTag("ResourceNotFoundException", () =>
              Effect.succeed(undefined),
            ),
          );
      });

      const readGuardrailTags = Effect.fn(function* (guardrailArn: string) {
        return yield* bedrock
          .listTagsForResource({ resourceARN: guardrailArn })
          .pipe(
            Effect.map((r) => toTagRecord(r.tags)),
            Effect.catchTag("ResourceNotFoundException", () =>
              Effect.succeed({} as Record<string, string>),
            ),
          );
      });

      const waitUntilReady = Effect.fn(function* (guardrailIdentifier: string) {
        return yield* bedrock.getGuardrail({ guardrailIdentifier }).pipe(
          Effect.flatMap((g) =>
            g.status === "READY" || g.status === "FAILED"
              ? Effect.succeed(g)
              : Effect.fail(new GuardrailNotReady({ status: g.status })),
          ),
          Effect.retry({
            while: (e) => "_tag" in e && e._tag === "GuardrailNotReady",
            schedule: Schedule.fixed(1000).pipe(
              Schedule.both(Schedule.recurs(60)),
            ),
          }),
        );
      });

      return Guardrail.Provider.of({
        stables: ["guardrailId", "guardrailArn", "guardrailName"],
        diff: Effect.fn(function* ({ id, news = {}, olds = {} }) {
          if (!isResolved(news)) return undefined;
          const oldName = yield* createGuardrailName(id, olds);
          const newName = yield* createGuardrailName(id, news);
          if (oldName !== newName) {
            return { action: "replace" } as const;
          }
        }),
        read: Effect.fn(function* ({ id, olds, output }) {
          const guardrailName =
            output?.guardrailName ??
            (yield* createGuardrailName(id, olds ?? {}));
          const observed = output?.guardrailId
            ? yield* readGuardrail(output.guardrailId)
            : undefined;
          let resolved = observed;
          if (!resolved) {
            const summary = yield* findGuardrailByName(guardrailName);
            if (summary?.id) {
              resolved = yield* readGuardrail(summary.id);
            }
          }
          if (!resolved) return undefined;
          return {
            guardrailId: resolved.guardrailId,
            guardrailArn: resolved.guardrailArn,
            guardrailName: unredact(resolved.name) ?? guardrailName,
            version: resolved.version,
            status: resolved.status,
          };
        }),
        reconcile: Effect.fn(function* ({ id, news, output, session }) {
          const guardrailName =
            output?.guardrailName ?? (yield* createGuardrailName(id, news));
          const internalTags = yield* createInternalTags(id);
          const desiredTags = { ...internalTags, ...news.tags };
          const blockedInputMessaging =
            news.blockedInputMessaging ?? DEFAULT_BLOCKED_INPUT;
          const blockedOutputsMessaging =
            news.blockedOutputsMessaging ?? DEFAULT_BLOCKED_OUTPUT;

          // Observe — try by stored id first, then by name.
          let observed = output?.guardrailId
            ? yield* readGuardrail(output.guardrailId)
            : undefined;
          if (!observed) {
            const summary = yield* findGuardrailByName(guardrailName);
            if (summary?.id) {
              observed = yield* readGuardrail(summary.id);
            }
          }

          // Ensure — create if missing.
          if (!observed) {
            const created = yield* bedrock
              .createGuardrail({
                name: guardrailName,
                description: news.description,
                blockedInputMessaging,
                blockedOutputsMessaging,
                topicPolicyConfig: news.topicPolicyConfig,
                contentPolicyConfig: news.contentPolicyConfig,
                wordPolicyConfig: news.wordPolicyConfig,
                sensitiveInformationPolicyConfig:
                  news.sensitiveInformationPolicyConfig,
                contextualGroundingPolicyConfig:
                  news.contextualGroundingPolicyConfig,
                automatedReasoningPolicyConfig:
                  news.automatedReasoningPolicyConfig,
                crossRegionConfig: news.crossRegionConfig,
                kmsKeyId: news.kmsKeyId,
                tags: Object.entries(desiredTags).map(([key, value]) => ({
                  key,
                  value,
                })),
              })
              .pipe(
                Effect.catchTag("ConflictException", () =>
                  Effect.succeed(undefined),
                ),
              );
            observed = created
              ? yield* readGuardrail(created.guardrailId)
              : undefined;
            if (!observed) {
              const summary = yield* findGuardrailByName(guardrailName);
              if (summary?.id) {
                observed = yield* readGuardrail(summary.id);
              }
            }
          } else {
            // Sync — update mutable fields. The DRAFT version is updated in
            // place; published versions are immutable and managed via
            // `createGuardrailVersion`.
            yield* bedrock.updateGuardrail({
              guardrailIdentifier: observed.guardrailId,
              name: guardrailName,
              description: news.description,
              blockedInputMessaging,
              blockedOutputsMessaging,
              topicPolicyConfig: news.topicPolicyConfig,
              contentPolicyConfig: news.contentPolicyConfig,
              wordPolicyConfig: news.wordPolicyConfig,
              sensitiveInformationPolicyConfig:
                news.sensitiveInformationPolicyConfig,
              contextualGroundingPolicyConfig:
                news.contextualGroundingPolicyConfig,
              automatedReasoningPolicyConfig:
                news.automatedReasoningPolicyConfig,
              crossRegionConfig: news.crossRegionConfig,
              kmsKeyId: news.kmsKeyId,
            });
            observed = yield* readGuardrail(observed.guardrailId);
          }

          if (!observed) {
            return yield* Effect.fail(
              new Error(`Failed to create Guardrail '${guardrailName}'`),
            );
          }

          const guardrailArn = observed.guardrailArn;

          // Sync tags — diff observed cloud tags against desired.
          const observedTags = yield* readGuardrailTags(guardrailArn);
          const { removed, upsert } = diffTags(observedTags, desiredTags);
          if (upsert.length > 0) {
            yield* bedrock.tagResource({
              resourceARN: guardrailArn,
              tags: upsert.map(({ Key, Value }) => ({
                key: Key,
                value: Value,
              })),
            });
          }
          if (removed.length > 0) {
            yield* bedrock.untagResource({
              resourceARN: guardrailArn,
              tagKeys: removed,
            });
          }

          // Wait until the guardrail is in a stable state so that callers
          // (e.g. `ApplyGuardrail`) see READY immediately.
          const ready = yield* waitUntilReady(observed.guardrailId);

          yield* session.note(guardrailArn);
          return {
            guardrailId: ready.guardrailId,
            guardrailArn,
            guardrailName,
            version: ready.version,
            status: ready.status,
          };
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* bedrock
            .deleteGuardrail({ guardrailIdentifier: output.guardrailId })
            .pipe(
              Effect.catchTag("ResourceNotFoundException", () => Effect.void),
            );
        }),
      });
    }),
  );
