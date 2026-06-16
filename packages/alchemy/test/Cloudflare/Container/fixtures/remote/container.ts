import * as Cloudflare from "@/Cloudflare";
import * as Effect from "effect/Effect";

/**
 * Remote container (`image` variant): Alchemy pulls the pre-built public
 * image and re-pushes it to Cloudflare's registry — no build, no `main`
 * bundling. The image is plain `nginx` serving on port 80, so `.make()` only
 * registers the container's identity so it can be bound to a Durable Object.
 */
export class RemoteContainer extends Cloudflare.Container<RemoteContainer>()(
  "RemoteContainer",
  { image: "nginx:alpine" },
) {}

export default RemoteContainer.make(Effect.succeed(undefined));
