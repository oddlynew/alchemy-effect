import { Retry } from "@distilled.cloud/cloudflare";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import { Command } from "../Build/Command.ts";
import * as Build from "../Build/index.ts";
import * as Provider from "../Provider.ts";
import { Random, RandomProvider } from "../Random.ts";
import * as Access from "./Access.ts";
import * as AiGateway from "./AiGateway/index.ts";
import * as ApiToken from "./ApiToken/index.ts";
import * as Artifacts from "./Artifacts/index.ts";
import { CloudflareAuth } from "./Auth/AuthProvider.ts";
import * as CloudflareEnvironment from "./CloudflareEnvironment.ts";
import * as Containers from "./Container/index.ts";
import * as Credentials from "./Credentials.ts";
import * as D1 from "./D1/index.ts";
import * as KV from "./KV/index.ts";
import * as Queue from "./Queue/index.ts";
import * as R2 from "./R2/index.ts";
import * as SecretsStore from "./SecretsStore/index.ts";
import * as Tunnel from "./Tunnel/index.ts";
import * as VpcService from "./VpcService/index.ts";
import * as Workers from "./Workers/index.ts";
import * as Workflows from "./Workers/Workflow.ts";

export { Credentials } from "@distilled.cloud/cloudflare/Credentials";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Cloudflare",
) {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Cloudflare providers, bindings, and credentials for Worker-based stacks.
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      ApiToken.AccountApiToken,
      ApiToken.UserApiToken,
      AiGateway.AiGateway,
      AiGateway.AiGatewayBindingPolicy,
      Artifacts.ArtifactsBindingPolicy,
      Command,
      Containers.Container,
      D1.D1ConnectionPolicy,
      D1.D1Database,
      KV.KVNamespace,
      KV.KVNamespaceBindingPolicy,
      Queue.Queue,
      Queue.QueueBindingPolicy,
      Queue.QueueConsumer,
      R2.R2Bucket,
      R2.R2BucketBindingPolicy,
      SecretsStore.SecretBindingPolicy,
      SecretsStore.SecretsStore,
      SecretsStore.Secret,
      Tunnel.Tunnel,
      VpcService.VpcService,
      Random,
      Workers.BindWorkerPolicy,
      Workers.FetchPolicy,
      Workers.Worker,
      Workflows.WorkflowResource,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ApiToken.AccountApiTokenProvider(),
        ApiToken.UserApiTokenProvider(),
        AiGateway.AiGatewayProvider(),
        AiGateway.AiGatewayBindingPolicyLive,
        Artifacts.ArtifactsBindingPolicyLive,
        Containers.ContainerProvider(),
        D1.D1ConnectionPolicyLive,
        D1.DatabaseProvider(),
        KV.KVNamespaceBindingPolicyLive,
        KV.KVNamespaceProvider(),
        Queue.QueueBindingPolicyLive,
        Queue.QueueProvider(),
        Queue.QueueConsumerProvider(),
        R2.R2BucketBindingPolicyLive,
        R2.R2BucketProvider(),
        SecretsStore.SecretBindingPolicyLive,
        SecretsStore.SecretsStoreProvider(),
        SecretsStore.StoreSecretProvider(),
        Tunnel.TunnelProvider(),
        VpcService.VpcServiceProvider(),
        Workers.BindWorkerPolicyLive,
        Workers.FetchPolicyLive,
        Workers.WorkerProvider(),
        Workflows.WorkflowProvider(),
      ),
    ),
    Layer.provideMerge(
      Layer.mergeAll(Build.CommandProvider(), RandomProvider()),
    ),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(CloudflareEnvironment.fromProfile()),
    Layer.provideMerge(CloudflareAuth),
    Layer.provideMerge(Access.AccessLive),
    // Apply a blanket retry policy to every Cloudflare API call. Extends
    // `Retry.makeDefault`'s transient detection (throttling / 5xx /
    // network) with Cloudflare's known "misleadingly-tagged" transient
    // errors — see `cloudflareRetryFactory` below. Without this, brief
    // auth-edge / internal blips during a deploy surface as test
    // failures and resource leaks.
    //
    // TODO(distilled): mark these cases with `withRetryable` upstream in
    // `@distilled.cloud/cloudflare/src/client/api.ts` so consumers don't
    // need to override the retry predicate.
    Layer.provideMerge(Layer.succeed(Retry.Retry, cloudflareRetryFactory)),
    Layer.orDie,
  );

const isMisleadinglyTaggedTransient = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const tag = (error as { _tag?: unknown })._tag;
  const message = ((error as { message?: unknown }).message ?? "") as string;
  // 10000: "Authentication error" — CF auth-edge blip; the token is
  // valid, the edge node returned 401 transiently.
  if (tag === "Unauthorized" && /authentication error/i.test(message))
    return true;
  // 10001: "internal error" — CF internal hiccup mistagged as 403.
  if (tag === "Forbidden" && /internal error/i.test(message)) return true;
  // Workers API sometimes wraps 5xx as WorkerNotFound.
  if (
    tag === "WorkerNotFound" &&
    /unknown error has occurred/i.test(message)
  ) {
    return true;
  }
  return false;
};

const cloudflareRetryFactory: Retry.Factory = (lastError) => {
  const defaults = Retry.makeDefault(lastError);
  return {
    while: (error) =>
      defaults.while?.(error) === true || isMisleadinglyTaggedTransient(error),
    schedule: pipe(
      Schedule.exponential(Duration.millis(250), 2),
      Schedule.modifyDelay(
        Effect.fnUntraced(function* (duration) {
          const error = yield* Ref.get(lastError);
          // Throttling errors (429): honor a 500ms floor matching the
          // distilled default.
          const isThrottling =
            (error as { _tag?: unknown })?._tag === "TooManyRequests";
          if (isThrottling && Duration.toMillis(duration) < 500) {
            return Duration.toMillis(Duration.millis(500));
          }
          return Duration.toMillis(duration);
        }),
      ),
      Retry.capped(Duration.seconds(5)),
      Retry.jittered,
      Schedule.both(Schedule.recurs(8)),
    ),
  };
};
