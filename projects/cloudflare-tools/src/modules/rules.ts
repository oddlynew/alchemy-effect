/**
 * Module rule parsing and defaults.
 *
 * Port of wrangler's deployment-bundle/rules.ts — defines the default
 * module rules for Cloudflare Workers and handles rule merging with
 * fallthrough semantics.
 */
import type { Rule } from "../types.js";

/**
 * Returns true if the rule type is ESModule or CommonJS (JavaScript).
 */
export function isJavaScriptModuleRule(rule: Rule): boolean {
	return rule.type === "ESModule" || rule.type === "CommonJS";
}

/**
 * Default module rules matching Cloudflare Workers conventions.
 *
 * - `.txt`, `.html`, `.sql` → Text modules
 * - `.bin` → Data (binary) modules
 * - `.wasm`, `.wasm?module` → CompiledWasm modules
 */
export const DEFAULT_MODULE_RULES: Rule[] = [
	{ type: "Text", globs: ["**/*.txt", "**/*.html", "**/*.sql"] },
	{ type: "Data", globs: ["**/*.bin"] },
	{ type: "CompiledWasm", globs: ["**/*.wasm", "**/*.wasm?module"] },
];

export interface ParsedRules {
	rules: Rule[];
	removedRules: Rule[];
}

/**
 * Parses user-defined module rules, merges them with defaults,
 * and handles fallthrough semantics.
 *
 * Rules without `fallthrough: true` "complete" their type — any
 * subsequent rules of the same type are marked as removed.
 */
export function parseRules(userRules: readonly Rule[] = []): ParsedRules {
	const rules: Rule[] = [...userRules, ...DEFAULT_MODULE_RULES];

	const completedRuleLocations: Record<string, number> = {};
	const rulesToRemove: Rule[] = [];
	let index = 0;

	for (const rule of rules) {
		if (rule.type in completedRuleLocations) {
			rulesToRemove.push(rule);
		}
		if (!(rule.type in completedRuleLocations) && rule.fallthrough !== true) {
			completedRuleLocations[rule.type] = index;
		}
		index++;
	}

	for (const rule of rulesToRemove) {
		const idx = rules.indexOf(rule);
		if (idx !== -1) {
			rules.splice(idx, 1);
		}
	}

	return { rules, removedRules: rulesToRemove };
}
