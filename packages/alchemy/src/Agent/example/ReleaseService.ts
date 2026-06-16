import * as Effect from "effect/Effect";

import * as Cloudflare from "../../Cloudflare/index.ts";
import * as Github from "../../GitHub/index.ts";
import { ReleaseVersion } from "./ReleaseVersion.ts";

export default Cloudflare.Worker(
  "ReleaseService",
  { main: import.meta.filename },
  Effect.gen(function* () {
    const versions = yield* ReleaseVersion;

    yield* Github.events({
      owner: "alchemy-run",
      repository: "alchemy-effect",
      events: ["push"],
    }).subscribe((event) => {
      const title = event.payload.head_commit?.message.split("\n")[0] ?? "";
      const isRelease =
        event.payload.ref === "refs/heads/main" &&
        title.startsWith("chore(release):");

      return isRelease
        ? versions.getByName(event.payload.head_commit!.id).generateBlog({
            input: event.payload,
          })
        : Effect.void;
    });
  }).pipe(Effect.provide(Cloudflare.GitHubRepositoryEventSourceLive)),
);
