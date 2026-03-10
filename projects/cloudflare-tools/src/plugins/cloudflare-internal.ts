/**
 * esbuild plugin that marks `cloudflare:*` imports as external.
 *
 * Workers that import from `cloudflare:workers`, `cloudflare:sockets`, etc.
 * must have those imports preserved — they're provided by the Workers runtime.
 *
 * Port of wrangler's cloudflare-internal.ts.
 */
import type { Plugin } from "esbuild";

export const cloudflareInternalPlugin: Plugin = {
	name: "distilled-cloudflare-internal",
	setup(build) {
		const paths = new Set<string>();
		build.onStart(() => paths.clear());

		build.onResolve({ filter: /^cloudflare:.*/ }, (args) => {
			paths.add(args.path);
			return { external: true };
		});

		build.onEnd(() => {
			if (build.initialOptions.format === "iife" && paths.size > 0) {
				const pathList = Array.from(paths)
					.map((p) => `"${p}"`)
					.sort()
					.join(", ");
				return {
					errors: [
						{
							text:
								`Unexpected external import of ${pathList}. ` +
								`Your worker has no default export, which means it is assumed to be a Service Worker format Worker. ` +
								`Did you mean to create a ES Module format Worker? ` +
								`If so, try adding \`export default { ... }\` in your entry-point. ` +
								`See https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/.`,
						},
					],
				};
			}
		});
	},
};
