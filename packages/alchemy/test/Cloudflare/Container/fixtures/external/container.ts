import * as Cloudflare from "@/Cloudflare";
import * as Effect from "effect/Effect";

/**
 * External container (`context` / `dockerfile` variant): Alchemy builds the
 * user-supplied Dockerfile against the build context directory — no `main`
 * bundling. The `dockerfile` defaults to `<context>/Dockerfile`.
 *
 * The image is plain `nginx` serving a static page on port 80, so there is no
 * Effect runtime; `.make()` only registers the container's identity so it can
 * be bound to a Durable Object.
 */
const context = `${import.meta.dirname}/context`;

export class ExternalContainer extends Cloudflare.Container<ExternalContainer>()(
  "ExternalContainer",
  { context },
) {}

export default ExternalContainer.make(Effect.succeed(undefined));
