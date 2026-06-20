# Two-Track Alchemy Strategy

This fork has two useful jobs, and they should stay distinct.

## Track 1: Maintainer-Facing Proof

The standalone `oddlynew/alchemy-effect` fork is the proof that Alchemy, Distilled, and
Cloudflare Tools can work better as one Nx monorepo.

Its promise is:

- preserve imported history and upstream syncability;
- keep the source layout understandable to Alchemy maintainers;
- prove the affected graph, R2-backed Nx cache, CI, docs, deploy, and release loop;
- publish a coherent `@oddlynew/*` distribution without hand-published scripts;
- avoid Oddlynew app-specific decisions unless they demonstrate generally useful fork mechanics.

This track is the artifact we can show upstream maintainers. It should answer: "If you wanted this
architecture, here is a concrete, working path."

## Track 2: Oddlynew-Owned Infrastructure

The Oddlynew product monorepo may still import Alchemy source directly if Alchemy becomes strategic
infrastructure for our own apps.

That track has a different promise:

- source lives in the same affected graph as our real applications;
- agents can update usage and implementation in one PR;
- features spanning app code, Alchemy resources, Distilled providers, and Cloudflare tooling do not
  depend on local linking or upstream release timing;
- Oddlynew-specific deployment resources, defaults, and product-driven changes can move at our
  speed.

This track is not primarily a maintainer migration artifact. It is an owned fork inside the main
Oddlynew monorepo.

## Why Both

As model capabilities improve, implementation gets cheaper and coordination becomes the bottleneck.
For strategic infrastructure, waiting for upstream review, cross-repo PR ordering, and release
cadence can cost more than maintaining a disciplined fork. The right response is not to collapse
everything into one promise.

The standalone fork keeps the upstream story clean. The Oddlynew import keeps our velocity path
clean.

## Boundaries

- Generic improvements should start in the standalone fork when practical, then flow upstream or into
  the Oddlynew monorepo.
- Oddlynew-specific app resources, product defaults, and private operational choices belong in the
  Oddlynew monorepo, not in the maintainer-facing proof.
- Upstream Alchemy, Distilled, and Cloudflare Tools changes should still be synced through the clean
  lane before heavy fork work in the same files.
- Divergence is acceptable, but it should be intentional and documented in the PR or the relevant
  operations note.

## Practical Sequence

1. Finish the standalone dogfood fork until CI and release dry-runs work from `main`.
2. Run the first real `@oddlynew/*` publish so package identity, changelogs, tags, and provenance are
   proven.
3. Create a separate branch in the main Oddlynew monorepo for an owned-source import plan.
4. Decide whether the main monorepo initially consumes published `@oddlynew/*` packages or imports
   source under `projects/alchemy/...`.
5. If importing source, preserve history with the same prefixed-history discipline used here, then
   wire the imported packages into Oddlynew's existing Nx plugins, cache, commitlint, and release
   model.
6. Keep upstream sync flowing through the standalone clean lane; merge or port generic changes into
   the main monorepo as needed.

Do not let the two tracks blur. The standalone fork is the clean argument for upstream maintainers.
The main Oddlynew monorepo is where we optimize for our own infrastructure speed.
