/**
 * Main bundle orchestrator.
 *
 * Assembles esbuild options and plugins, runs the build via the Esbuild
 * Effect service, and post-processes the result into a BundleResult.
 */
import * as Effect from "effect/Effect";
import path from "node:path";
import { Esbuild } from "./esbuild.js";
import { getEntryPointFromMetafile } from "./metafile.js";
import { dedupeModulesByName } from "./modules/dedupe.js";
import { writeAdditionalModules } from "./modules/write.js";
import { cloudflareInternalPlugin } from "./plugins/cloudflare-internal.js";
import { createModuleCollector } from "./plugins/module-collector.js";
import { nodejsCompatPlugin } from "./plugins/nodejs-compat.js";
import type { BundleOptions, BundleResult, CfModule } from "./types.js";
import type { Plugin } from "esbuild";

/**
 * Common esbuild options matching wrangler's configuration.
 */
const COMMON_ESBUILD_OPTIONS = {
	target: "es2024",
	loader: {
		".js": "jsx" as const,
		".mjs": "jsx" as const,
		".cjs": "jsx" as const,
	},
};

/**
 * Build conditions for Cloudflare Workers.
 * These affect how package.json "exports" fields are resolved.
 */
const BUILD_CONDITIONS = ["workerd", "worker", "browser"];

/**
 * Bundles a Cloudflare Worker entry point using esbuild.
 *
 * Requires the `Esbuild` service to be provided via a Layer.
 */
export function bundle(
	options: BundleOptions,
): Effect.Effect<BundleResult, import("./esbuild.js").EsbuildError, Esbuild> {
	return Effect.gen(function* () {
		const esbuild = yield* Esbuild;

		// Collect plugins in order
		const plugins: Plugin[] = [];

		// Module collector plugin — intercepts WASM, text, binary imports
		const moduleCollector = createModuleCollector({
			rules: options.rules ? [...options.rules] : undefined,
			preserveFileNames: options.preserveFileNames,
		});
		plugins.push(moduleCollector.plugin);

		// Node.js compatibility plugin — applies unenv polyfills when nodejs_compat is enabled
		const hasNodejsCompat = options.compatibilityFlags?.some(
			(f) => f === "nodejs_compat" || f === "nodejs_compat_v2",
		);
		if (hasNodejsCompat) {
			plugins.push(
				nodejsCompatPlugin({
					compatibilityDate: options.compatibilityDate,
					compatibilityFlags: options.compatibilityFlags,
				}),
			);
		}

		// Cloudflare internal imports plugin — always applied
		plugins.push(cloudflareInternalPlugin);

		// Build the define map
		const define: Record<string, string> = {
			// process.env.NODE_ENV replacement (3 variants for different access patterns)
			"process.env.NODE_ENV": '"production"',
			"global.process.env.NODE_ENV": '"production"',
			"globalThis.process.env.NODE_ENV": '"production"',
			// User-defined replacements
			...options.define,
		};

		// Run esbuild
		const result = yield* esbuild.build({
			entryPoints: [options.entryPoint],
			bundle: true,
			absWorkingDir: options.projectRoot,
			outdir: options.outputDir,
			format: "esm",
			target: COMMON_ESBUILD_OPTIONS.target,
			sourcemap: true,
			metafile: true,
			conditions: BUILD_CONDITIONS,
			define,
			loader: COMMON_ESBUILD_OPTIONS.loader,
			logLevel: "silent",
			external: [...(options.external ?? [])],
			plugins,
		});

		// Extract entry point from metafile
		const entryPointInfo = getEntryPointFromMetafile(
			options.entryPoint,
			result.metafile!,
		);

		// Determine bundle type from exports
		const bundleType =
			entryPointInfo.exports.length > 0 ? "esm" : "commonjs";

		// Resolve the absolute entry point path
		const resolvedEntryPoint = path.resolve(
			options.outputDir,
			entryPointInfo.relativePath,
		);

		// Deduplicate and write additional modules
		const modules = dedupeModulesByName([...moduleCollector.modules]);
		if (modules.length > 0) {
			yield* Effect.promise(() =>
				writeAdditionalModules(
					modules,
					path.dirname(resolvedEntryPoint),
				),
			);
		}

		return {
			entryPoint: resolvedEntryPoint,
			modules,
			bundleType,
			outputDir: options.outputDir,
		} satisfies BundleResult;
	});
}
