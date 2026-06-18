import * as AWS from "alchemy/AWS";
import type * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

// `FROM cloudflare/cloudflared` — the official image's ENTRYPOINT runs the
// connector; `tunnel run` reads the token from TUNNEL_TOKEN. The bundled `main`
// (the trivial cloudflared-entry) is ignored by this Dockerfile.
const DOCKERFILE = `FROM cloudflare/cloudflared:latest\nCMD ["tunnel", "run"]\n`;

const entry = new URL("./cloudflared-entry.ts", import.meta.url).pathname;

/**
 * ECS Fargate task definition for the cloudflared connector. A factory (not a
 * class) so the Tunnel's connector token can be injected as `TUNNEL_TOKEN`.
 */
export default (options: { tunnelToken: Output.Output<string> }) =>
  AWS.ECS.Task(
    "CloudflaredTask",
    {
      main: entry,
      docker: { dockerfile: DOCKERFILE },
      env: { TUNNEL_TOKEN: options.tunnelToken },
      cpu: 256,
      memory: 512,
    },
    // The container is the cloudflared image (see Dockerfile); the bundled
    // entrypoint is never executed, so the runtime body is a no-op.
    Effect.void,
  );
