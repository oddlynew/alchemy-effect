/**
 * Internal types for distilled-bundler.
 */

/**
 * A collected module (WASM, text, binary, etc.) — part of the bundle output.
 * Matches the shape of wrangler's CfModule.
 */
export interface CfModule {
	/** Module name (relative path, possibly hashed) */
	name: string;
	/** Absolute path to the source file */
	filePath: string;
	/** Raw file content */
	content: Buffer | Uint8Array;
	/** The Cloudflare module type */
	type: CfModuleType;
}

/**
 * Module types used in Cloudflare Worker uploads.
 */
export type CfModuleType =
	| "esm"
	| "commonjs"
	| "compiled-wasm"
	| "text"
	| "buffer";

/**
 * Module rule types matching Cloudflare's config schema.
 */
export type ConfigModuleRuleType =
	| "ESModule"
	| "CommonJS"
	| "CompiledWasm"
	| "Text"
	| "Data";

/**
 * A module rule defining how non-JS file types are handled.
 */
export interface Rule {
	type: ConfigModuleRuleType;
	globs: string[];
	fallthrough?: boolean;
}

/**
 * Maps config rule types to internal module types.
 */
export const RuleTypeToModuleType: Record<ConfigModuleRuleType, CfModuleType> =
	{
		ESModule: "esm",
		CommonJS: "commonjs",
		CompiledWasm: "compiled-wasm",
		Data: "buffer",
		Text: "text",
	};

/**
 * The input configuration for a bundle operation.
 */
export interface BundleOptions {
	/** Absolute path to the entry point */
	readonly entryPoint: string;
	/** Absolute path to the project root */
	readonly projectRoot: string;
	/** Absolute path to the output directory */
	readonly outputDir: string;
	/** Cloudflare compatibility date */
	readonly compatibilityDate?: string;
	/** Cloudflare compatibility flags (e.g., ["nodejs_compat"]) */
	readonly compatibilityFlags?: readonly string[];
	/** esbuild define replacements */
	readonly define?: Record<string, string>;
	/** Module rules for non-JS imports */
	readonly rules?: readonly Rule[];
	/** Whether to scan the filesystem for additional modules */
	readonly findAdditionalModules?: boolean;
	/** Preserve original file names instead of content-hashing */
	readonly preserveFileNames?: boolean;
	/** Additional imports to mark as external */
	readonly external?: readonly string[];
}

/**
 * The output of a bundle operation.
 */
export interface BundleResult {
	/** Absolute path to the main output file */
	readonly entryPoint: string;
	/** Additional modules collected during bundling */
	readonly modules: readonly CfModule[];
	/** The module format of the entry point */
	readonly bundleType: "esm" | "commonjs";
	/** Absolute path to the output directory */
	readonly outputDir: string;
}
