import * as Schema from "effect/Schema";

export const ModuleType = Schema.Literals([
  "CommonJS",
  "ESModule",
  "Text",
  "Data",
  "CompiledWasm",
  "SourceMap",
  "PythonModule",
  "PythonRequirement",
]);
export type ModuleType = typeof ModuleType.Type;

export class Module extends Schema.Class<Module>("distilled-core/Module")({
  name: Schema.String,
  content: Schema.Uint8Array,
  hash: Schema.String,
  type: ModuleType,
}) {}

export const MODULE_TYPE_TO_CONTENT_TYPE: Record<ModuleType, string> = {
  CommonJS: "application/javascript",
  ESModule: "application/javascript+module",
  CompiledWasm: "application/wasm",
  Text: "text/plain",
  Data: "application/octet-stream",
  SourceMap: "application/source-map",
  PythonModule: "text/x-python",
  PythonRequirement: "text/x-python-requirement",
};
