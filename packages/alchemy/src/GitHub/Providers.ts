import * as Layer from "effect/Layer";
import * as Provider from "../Provider.ts";
import { GitHubAuth } from "./AuthProvider.ts";
import { Comment, CommentProvider } from "./Comment.ts";
import * as Credentials from "./Credentials.ts";
import { Repository, RepositoryProvider } from "./Repository.ts";
import { Secret, SecretProvider } from "./Secret.ts";
import { Variable, VariableProvider } from "./Variable.ts";
import { Webhook, WebhookProvider } from "./Webhook.ts";

export { GitHubCredentials } from "./Credentials.ts";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "GitHub",
) {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * GitHub providers plus the GitHub AuthProvider that `alchemy login`
 * discovers. Resources covered: `Repository`, `Webhook`, `Comment`,
 * `Secret`, `Variable`. Runtime capabilities (`IssueComments`, `Git`,
 * `Contents`, …) are not registered here — they are provided as a Worker
 * layer via `GitHub.CapabilitiesLive`.
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([Comment, Repository, Secret, Variable, Webhook]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        CommentProvider(),
        RepositoryProvider(),
        SecretProvider(),
        VariableProvider(),
        WebhookProvider(),
      ),
    ),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(GitHubAuth),
    Layer.orDie,
  );
