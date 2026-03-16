import crypto from "node:crypto";
import path from "node:path";

export const raw = true;
export const wasmExternalPrefix = "__CLOUDFLARE_WASM_MODULE__/";

export default function wasmLoader(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const options = this.getOptions?.() ?? {};
  const baseName = path.basename(this.resourcePath);
  const fileName =
    options.preserveFileNames === true
      ? baseName
      : `${crypto.createHash("sha1").update(bytes).digest("hex")}-${baseName}`;

  return `import wasm from "${wasmExternalPrefix}${fileName}"; export default wasm;`;
}
