import * as Cloudflare from "@/Cloudflare";
import * as Alchemy from "@/index.ts";
import * as Effect from "effect/Effect";
import EffectfulContainerLive from "./container.ts";
import EffectfulContainerWorker from "./worker.ts";

export default Alchemy.Stack(
  "EffectfulContainerStack",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const worker = yield* EffectfulContainerWorker;
    return { url: worker.url.as<string>() };
  }).pipe(Effect.provide(EffectfulContainerLive)),
);
