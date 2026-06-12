import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { CredentialsStoreLive } from "../Auth/Credentials.ts";
import { ProfileLive } from "../Auth/Profile.ts";
import * as Provider from "../Provider.ts";
import { RailwayAuth } from "./AuthProvider.ts";
import { ConnectPolicy, ConnectPolicyLive } from "./Connect.ts";
import * as Credentials from "./Credentials.ts";
import { CustomDomain, CustomDomainProvider } from "./CustomDomain.ts";
import { Database, DatabaseProvider } from "./Database.ts";
import { DatabaseUrlPolicy, DatabaseUrlPolicyLive } from "./DatabaseUrl.ts";
import { Environment, EnvironmentProvider } from "./Environment.ts";
import { Function, FunctionProvider } from "./Function.ts";
import { Project, ProjectProvider } from "./Project.ts";
import { ProjectToken, ProjectTokenProvider } from "./ProjectToken.ts";
import { Service, ServiceProvider } from "./Service.ts";
import { ServiceDomain, ServiceDomainProvider } from "./ServiceDomain.ts";
import { TcpProxy, TcpProxyProvider } from "./TcpProxy.ts";
import { Variables, VariablesProvider } from "./Variables.ts";
import { Volume, VolumeProvider } from "./Volume.ts";
import { VolumeMountPolicy, VolumeMountPolicyLive } from "./VolumeMount.ts";
import { Webhook, WebhookProvider } from "./Webhook.ts";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Railway",
) {}

/**
 * Build a layer that registers all Railway resource providers, the Railway
 * `AuthProvider`, the resolved `Credentials`, and an `HttpClient`. Include
 * this from your stack alongside other cloud `providers()` layers.
 *
 * @example
 * ```typescript
 * import * as Alchemy from "alchemy";
 * import * as Railway from "alchemy/Railway";
 * import * as Effect from "effect/Effect";
 *
 * export default Alchemy.Stack(
 *   "MyStack",
 *   { providers: Railway.providers(), state: Alchemy.localState() },
 *   Effect.gen(function* () {
 *     const project = yield* Railway.Project("app");
 *     const api = yield* Railway.Service("api", {
 *       project,
 *       source: { image: "nginx:alpine" },
 *     });
 *     const domain = yield* Railway.ServiceDomain("api-domain", {
 *       service: api,
 *     });
 *     return { url: domain.url };
 *   }),
 * );
 * ```
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      Project,
      ProjectToken,
      Environment,
      Service,
      Function,
      ServiceDomain,
      CustomDomain,
      TcpProxy,
      Volume,
      Variables,
      Database,
      Webhook,
      ConnectPolicy,
      DatabaseUrlPolicy,
      VolumeMountPolicy,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ProjectProvider(),
        ProjectTokenProvider(),
        EnvironmentProvider(),
        ServiceProvider(),
        FunctionProvider(),
        ServiceDomainProvider(),
        CustomDomainProvider(),
        TcpProxyProvider(),
        VolumeProvider(),
        VariablesProvider(),
        DatabaseProvider(),
        WebhookProvider(),
        ConnectPolicyLive,
        DatabaseUrlPolicyLive,
        VolumeMountPolicyLive,
      ),
    ),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(RailwayAuth),
    Layer.provideMerge(ProfileLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.orDie,
  );
