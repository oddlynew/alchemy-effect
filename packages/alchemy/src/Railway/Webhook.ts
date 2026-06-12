import {
  createNotificationRule,
  deleteNotificationRule,
  getNotificationRules,
  getProject,
  updateNotificationRule,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { resolveProjectId, type ProjectSource } from "./Environment.ts";
import type { Providers } from "./Providers.ts";

export type WebhookSeverity = "CRITICAL" | "INFO" | "NOTICE" | "WARNING";

export type WebhookProps = {
  /**
   * The Railway project (or `{ projectId }`) the webhook is scoped to.
   * Changing it replaces the webhook.
   */
  project: ProjectSource;
  /**
   * The HTTPS endpoint that receives event payloads. Railway POSTs a JSON
   * payload to this URL whenever a subscribed event fires.
   */
  url: string;
  /**
   * Event types to subscribe to, e.g. `["Deployment.failed",
   * "Deployment.crashed"]`. Railway does not validate these — see the
   * webhooks docs for the payload `type` values it emits.
   */
  eventTypes: string[];
  /**
   * Only deliver events with one of these severities. When omitted,
   * events of every severity are delivered.
   */
  severities?: WebhookSeverity[];
};

export type Webhook = Resource<
  "Railway.Webhook",
  WebhookProps,
  {
    /** ID of the backing notification rule. */
    webhookId: string;
    url: string;
    eventTypes: string[];
    projectId: string;
    workspaceId: string;
  },
  never,
  Providers
>;

/**
 * A Railway project webhook — POSTs a JSON payload to a URL when platform
 * events (deployment status changes, volume/usage alerts, …) fire for the
 * project.
 *
 * Railway models webhooks as *notification rules* with a `WEBHOOK`
 * channel; this resource manages one rule scoped to the given project.
 *
 * Note: Railway currently rejects in-place updates and deletes of
 * notification rules for workspace-scoped tokens (`Not Authorized`). With
 * such a token, Alchemy converges updates by creating a replacement rule
 * and logs a warning when the superseded rule cannot be removed. Use a
 * personal (account) token to avoid leaking superseded rules.
 *
 * @section Creating a Webhook
 * @example Notify an endpoint on failed deploys
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const webhook = yield* Railway.Webhook("alerts", {
 *   project,
 *   url: "https://hooks.example.com/railway",
 *   eventTypes: ["Deployment.failed", "Deployment.crashed"],
 * });
 * ```
 *
 * @example Only deliver critical events
 * ```typescript
 * const webhook = yield* Railway.Webhook("pager", {
 *   project,
 *   url: "https://hooks.example.com/pager",
 *   eventTypes: ["Deployment.failed"],
 *   severities: ["CRITICAL"],
 * });
 * ```
 *
 * @see https://docs.railway.com/observability/webhooks
 */
export const Webhook = Resource<Webhook>("Railway.Webhook");

/** Extract the URL of a rule's `WEBHOOK` channel, if it has one. */
const getWebhookUrl = (
  channels: ReadonlyArray<{ config: unknown }>,
): string | undefined => {
  for (const { config } of channels) {
    if (
      typeof config === "object" &&
      config !== null &&
      "type" in config &&
      config.type === "WEBHOOK" &&
      "url" in config &&
      typeof config.url === "string"
    ) {
      return config.url;
    }
  }
  return undefined;
};

/** Order-insensitive comparison of two string lists. */
const sameMembers = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length &&
  [...a].sort().join("\n") === [...b].sort().join("\n");

const resolveWorkspaceId = (projectId: string) =>
  Effect.gen(function* () {
    const project = yield* getProject({ id: projectId });
    if (!project.workspaceId) {
      throw new Error(
        `Railway project ${projectId} has no workspaceId — cannot manage webhooks`,
      );
    }
    return project.workspaceId;
  });

/**
 * Best-effort removal of a notification rule. Railway rejects
 * `notificationRuleDelete` for workspace-scoped tokens (and also returns
 * `Not Authorized` for rules that are already gone) — verify whether the
 * rule is still visible and warn instead of failing the operation.
 */
const removeRule = (args: {
  ruleId: string;
  workspaceId: string;
  projectId: string;
}) =>
  Effect.gen(function* () {
    yield* deleteNotificationRule({ id: args.ruleId }).pipe(
      Effect.catchTags({
        ProblemProcessingRequest: () => Effect.void,
        NotAuthorized: () =>
          Effect.gen(function* () {
            const rules = yield* getNotificationRules({
              workspaceId: args.workspaceId,
              projectId: args.projectId,
            }).pipe(
              Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
            );
            if (rules?.some((r) => r.id === args.ruleId)) {
              yield* Effect.logWarning(
                `Railway rejected deletion of notification rule ${args.ruleId} ` +
                  `(workspace-scoped tokens cannot delete notification rules). ` +
                  `The webhook may keep firing until removed in the dashboard ` +
                  `or its project is deleted.`,
              );
            }
          }),
      }),
    );
  });

export const WebhookProvider = () =>
  Provider.succeed(Webhook, {
    stables: ["projectId", "workspaceId"],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const projectId = resolveProjectId(news.project as ProjectSource);
        if (projectId !== output.projectId) {
          return { action: "replace" } as const;
        }
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      if (!output?.webhookId) return undefined;
      const rules = yield* getNotificationRules({
        workspaceId: output.workspaceId,
        projectId: output.projectId,
      }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
      );
      const match = rules?.find((r) => r.id === output.webhookId);
      if (!match) return undefined;
      return {
        ...output,
        url: getWebhookUrl(match.channels) ?? output.url,
        eventTypes: [...match.eventTypes],
      };
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const projectId = resolveProjectId(news.project as ProjectSource);
      const workspaceId =
        output?.workspaceId ?? (yield* resolveWorkspaceId(projectId));
      const desiredChannel = { type: "WEBHOOK", url: news.url };

      // Observe — the backing notification rule, if it still exists.
      const rules = yield* getNotificationRules({ workspaceId, projectId });
      const observed = output?.webhookId
        ? rules.find((r) => r.id === output.webhookId)
        : undefined;

      // Ensure — create the rule when missing.
      const created = observed
        ? undefined
        : yield* createNotificationRule({
            input: {
              workspaceId,
              projectId,
              eventTypes: news.eventTypes,
              severities: news.severities,
              channelConfigs: [desiredChannel],
            },
          });

      // Sync — converge url / eventTypes / severities on the observed rule.
      let webhookId = (observed ?? created!).id;
      if (observed) {
        const drifted =
          getWebhookUrl(observed.channels) !== news.url ||
          !sameMembers(observed.eventTypes, news.eventTypes) ||
          (news.severities !== undefined &&
            !sameMembers(observed.severities, news.severities));
        if (drifted) {
          yield* updateNotificationRule({
            id: observed.id,
            input: {
              channelConfigs: [desiredChannel],
              eventTypes: news.eventTypes,
              severities: news.severities,
            },
          }).pipe(
            // Workspace-scoped tokens cannot mutate rules in place —
            // converge by creating a replacement and removing the old
            // rule on a best-effort basis.
            Effect.catchTag("NotAuthorized", () =>
              Effect.gen(function* () {
                const replacement = yield* createNotificationRule({
                  input: {
                    workspaceId,
                    projectId,
                    eventTypes: news.eventTypes,
                    severities: news.severities,
                    channelConfigs: [desiredChannel],
                  },
                });
                webhookId = replacement.id;
                yield* removeRule({
                  ruleId: observed.id,
                  workspaceId,
                  projectId,
                });
                return replacement;
              }),
            ),
          );
        }
      }

      return {
        webhookId,
        url: news.url,
        eventTypes: [...news.eventTypes],
        projectId,
        workspaceId,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* removeRule({
        ruleId: output.webhookId,
        workspaceId: output.workspaceId,
        projectId: output.projectId,
      });
    }),
  });
