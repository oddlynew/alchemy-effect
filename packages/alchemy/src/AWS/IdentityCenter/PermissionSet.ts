import * as ssoAdmin from "@distilled.cloud/aws/sso-admin";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Unowned } from "../../AdoptPolicy.ts";
import { isResolved } from "../../Diff.ts";
import * as Provider from "../../Provider.ts";
import { Resource } from "../../Resource.ts";
import {
  createInternalTags,
  createTagsList,
  diffTags,
  hasAlchemyTags,
} from "../../Tags.ts";
import type { Providers } from "../Providers.ts";
import { resolveInstance, retryIdentityCenter } from "./common.ts";

export interface PermissionSetProps {
  /**
   * Explicit IAM Identity Center instance ARN.
   * If omitted, Alchemy adopts the only visible instance.
   */
  instanceArn?: string;
  /**
   * Permission set name. Stable — changing this triggers a replace.
   */
  name: string;
  /**
   * Optional human-readable description.
   */
  description?: string;
  /**
   * Optional ISO-8601 session duration such as `PT8H`.
   */
  sessionDuration?: string;
  /**
   * Optional relay state passed to supported applications.
   */
  relayState?: string;
  /**
   * Optional tags. Internal `alchemy::*` ownership tags are merged in
   * automatically and used for adoption gating.
   */
  tags?: Record<string, string>;
}

export interface PermissionSet extends Resource<
  "AWS.IdentityCenter.PermissionSet",
  PermissionSetProps,
  {
    instanceArn: string;
    permissionSetArn: string;
    name: string;
    description: string | undefined;
    sessionDuration: string | undefined;
    relayState: string | undefined;
    createdDate: Date | undefined;
    tags: Record<string, string>;
  },
  never,
  Providers
> {}

class PermissionSetMissingAfterCreate extends Data.TaggedError(
  "PermissionSetMissingAfterCreate",
)<{ readonly name: string }> {}

class PermissionSetMissingAfterUpdate extends Data.TaggedError(
  "PermissionSetMissingAfterUpdate",
)<{ readonly permissionSetArn: string }> {}

/**
 * An IAM Identity Center permission set.
 *
 * @section Creating Permission Sets
 * @example Administrator Access
 * ```typescript
 * const admin = yield* PermissionSet("AdministratorAccess", {
 *   name: "AdministratorAccess",
 *   description: "Administrator access for platform engineers",
 *   sessionDuration: "PT8H",
 * });
 * ```
 */
export const PermissionSet = Resource<PermissionSet>(
  "AWS.IdentityCenter.PermissionSet",
);

export const PermissionSetProvider = () =>
  Provider.effect(
    PermissionSet,
    Effect.gen(function* () {
      return {
        stables: ["permissionSetArn", "instanceArn"],
        diff: Effect.fn(function* ({ olds, news }) {
          if (!isResolved(news)) return;
          if (
            olds?.instanceArn !== news.instanceArn ||
            olds?.name !== news.name
          ) {
            return { action: "replace" } as const;
          }
        }),
        read: Effect.fn(function* ({ id, olds, output }) {
          const observed = output?.permissionSetArn && output.instanceArn
            ? yield* readPermissionSetByArn({
                instanceArn: output.instanceArn,
                permissionSetArn: output.permissionSetArn,
              })
            : olds
              ? yield* readPermissionSetByName(olds)
              : undefined;

          if (!observed) {
            return undefined;
          }

          // Ownership gate — adoption is the engine's call. If the
          // resource lacks our alchemy tags, signal `Unowned` so the
          // engine refuses to take it over without `--adopt`.
          return (yield* hasAlchemyTags(id, observed.tags))
            ? observed
            : Unowned(observed);
        }),
        reconcile: Effect.fn(function* ({ id, news, output, session }) {
          const instance = yield* resolveInstance(
            output?.instanceArn ?? news.instanceArn,
          );

          const desiredTags = {
            ...(yield* createInternalTags(id)),
            ...news.tags,
          };

          // Observe — find the permission set by ARN (when we already
          // have one) or by name on the resolved instance. Cloud state is
          // authoritative; `output` is just a cached identifier hint.
          let existing =
            (output?.permissionSetArn
              ? yield* readPermissionSetByArn({
                  instanceArn: instance.InstanceArn!,
                  permissionSetArn: output.permissionSetArn,
                })
              : undefined) ??
            (yield* readPermissionSetByName({
              ...news,
              instanceArn: instance.InstanceArn,
            }));

          // Ensure — create the permission set if missing. Tags are
          // applied in-band so a crash before sync still leaves an
          // owned-looking resource for the next reconcile.
          if (!existing) {
            const response = yield* retryIdentityCenter(
              ssoAdmin.createPermissionSet({
                InstanceArn: instance.InstanceArn!,
                Name: news.name,
                Description: news.description,
                SessionDuration: news.sessionDuration,
                RelayState: news.relayState,
                Tags: createTagsList(desiredTags),
              }),
            );

            const createdArn = response.PermissionSet?.PermissionSetArn;
            existing =
              (createdArn
                ? yield* readPermissionSetByArn({
                    instanceArn: instance.InstanceArn!,
                    permissionSetArn: createdArn,
                  })
                : undefined) ??
              (yield* readPermissionSetByName({
                ...news,
                instanceArn: instance.InstanceArn,
              }));

            if (!existing) {
              return yield* Effect.fail(
                new PermissionSetMissingAfterCreate({ name: news.name }),
              );
            }

            yield* session.note(existing.permissionSetArn);
            return existing;
          }

          // Sync mutable attributes — `updatePermissionSet` overwrites
          // description, sessionDuration, relayState. Diff against
          // observed cloud state (not olds) so adoption converges; only
          // call when there's a real delta.
          if (
            (existing.description ?? undefined) !== news.description ||
            (existing.sessionDuration ?? undefined) !== news.sessionDuration ||
            (existing.relayState ?? undefined) !== news.relayState
          ) {
            yield* retryIdentityCenter(
              ssoAdmin.updatePermissionSet({
                InstanceArn: existing.instanceArn,
                PermissionSetArn: existing.permissionSetArn,
                Description: news.description,
                SessionDuration: news.sessionDuration,
                RelayState: news.relayState,
              }),
            );

            const updated = yield* readPermissionSetByArn({
              instanceArn: existing.instanceArn,
              permissionSetArn: existing.permissionSetArn,
            });
            if (!updated) {
              return yield* Effect.fail(
                new PermissionSetMissingAfterUpdate({
                  permissionSetArn: existing.permissionSetArn,
                }),
              );
            }
            existing = updated;
          }

          // Sync tags — diff against OBSERVED cloud tags so adoption
          // re-tags a foreign resource and out-of-band drift converges.
          existing = yield* syncPermissionSetTags({
            instanceArn: existing.instanceArn,
            permissionSetArn: existing.permissionSetArn,
            observedTags: existing.tags,
            desiredTags,
          });

          yield* session.note(existing.permissionSetArn);
          return existing;
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* retryIdentityCenter(
            ssoAdmin
              .deletePermissionSet({
                InstanceArn: output.instanceArn,
                PermissionSetArn: output.permissionSetArn,
              })
              .pipe(
                Effect.catchTag("ResourceNotFoundException", () => Effect.void),
              ),
          );
        }),
      };
    }),
  );

const readPermissionSetByArn = Effect.fn(function* ({
  instanceArn,
  permissionSetArn,
}: {
  instanceArn: string;
  permissionSetArn: string;
}) {
  const response = yield* retryIdentityCenter(
    ssoAdmin
      .describePermissionSet({
        InstanceArn: instanceArn,
        PermissionSetArn: permissionSetArn,
      })
      .pipe(
        Effect.catchTag("ResourceNotFoundException", () =>
          Effect.succeed(undefined),
        ),
      ),
  );

  const permissionSet = response?.PermissionSet;
  if (!permissionSet?.PermissionSetArn || !permissionSet.Name) {
    return undefined;
  }

  const tags = yield* readPermissionSetTags({
    instanceArn,
    permissionSetArn: permissionSet.PermissionSetArn,
  });

  return {
    instanceArn,
    permissionSetArn: permissionSet.PermissionSetArn,
    name: permissionSet.Name,
    description: permissionSet.Description,
    sessionDuration: permissionSet.SessionDuration,
    relayState: permissionSet.RelayState,
    createdDate: permissionSet.CreatedDate,
    tags,
  } satisfies PermissionSet["Attributes"];
});

const readPermissionSetByName = Effect.fn(function* ({
  instanceArn,
  name,
}: Pick<PermissionSetProps, "instanceArn" | "name">) {
  const instance = yield* resolveInstance(instanceArn);
  const arns = yield* ssoAdmin.listPermissionSets
    .items({
      InstanceArn: instance.InstanceArn!,
      MaxResults: 100,
    })
    .pipe(Stream.runCollect);

  for (const permissionSetArn of arns) {
    const permissionSet = yield* readPermissionSetByArn({
      instanceArn: instance.InstanceArn!,
      permissionSetArn,
    });
    if (permissionSet?.name === name) {
      return permissionSet;
    }
  }

  return undefined;
});

const readPermissionSetTags = Effect.fn(function* ({
  instanceArn,
  permissionSetArn,
}: {
  instanceArn: string;
  permissionSetArn: string;
}) {
  // listTagsForResource is non-paginated in our usage — Permission Sets
  // ship with a small fixed tag budget, but iterate NextToken just in
  // case to be safe.
  const tags: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const response: ssoAdmin.ListTagsForResourceResponse =
      yield* retryIdentityCenter(
        ssoAdmin
          .listTagsForResource({
            InstanceArn: instanceArn,
            ResourceArn: permissionSetArn,
            NextToken: nextToken,
          })
          .pipe(
            Effect.catchTag("ResourceNotFoundException", () =>
              Effect.succeed({
                Tags: [],
                NextToken: undefined,
              } as ssoAdmin.ListTagsForResourceResponse),
            ),
          ),
      );
    for (const tag of response.Tags ?? []) {
      if (tag.Key !== undefined && tag.Value !== undefined) {
        tags[tag.Key] = tag.Value;
      }
    }
    nextToken = response.NextToken;
  } while (nextToken);
  return tags;
});

const syncPermissionSetTags = Effect.fn(function* ({
  instanceArn,
  permissionSetArn,
  observedTags,
  desiredTags,
}: {
  instanceArn: string;
  permissionSetArn: string;
  observedTags: Record<string, string>;
  desiredTags: Record<string, string>;
}) {
  const { added, updated, removed } = diffTags(observedTags, desiredTags);
  const upsert = [...added, ...updated];

  if (upsert.length > 0) {
    yield* retryIdentityCenter(
      ssoAdmin.tagResource({
        InstanceArn: instanceArn,
        ResourceArn: permissionSetArn,
        Tags: upsert,
      }),
    );
  }

  if (removed.length > 0) {
    yield* retryIdentityCenter(
      ssoAdmin.untagResource({
        InstanceArn: instanceArn,
        ResourceArn: permissionSetArn,
        TagKeys: removed,
      }),
    );
  }

  if (upsert.length === 0 && removed.length === 0) {
    return yield* readPermissionSetByArn({
      instanceArn,
      permissionSetArn,
    }).pipe(
      Effect.flatMap((value) =>
        value
          ? Effect.succeed(value)
          : Effect.fail(
              new PermissionSetMissingAfterUpdate({ permissionSetArn }),
            ),
      ),
    );
  }

  // Re-read so the returned attributes reflect the actual cloud state.
  const refreshed = yield* readPermissionSetByArn({
    instanceArn,
    permissionSetArn,
  });
  if (!refreshed) {
    return yield* Effect.fail(
      new PermissionSetMissingAfterUpdate({ permissionSetArn }),
    );
  }
  return refreshed;
});
