/**
 * Write additional modules to the output directory.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CfModule } from "../types.js";

/**
 * Writes collected modules (WASM, text, data) as separate files
 * to the output directory, preserving any subdirectory structure.
 */
export async function writeAdditionalModules(
	modules: readonly CfModule[],
	destination: string,
): Promise<void> {
	for (const module of modules) {
		const modulePath = path.resolve(destination, module.name);
		await mkdir(path.dirname(modulePath), { recursive: true });
		await writeFile(modulePath, module.content);
	}
}
