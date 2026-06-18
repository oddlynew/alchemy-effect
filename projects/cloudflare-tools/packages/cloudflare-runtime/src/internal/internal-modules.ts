import type { Module } from "../RuntimeWorker.ts";
import type * as WorkerdConfig from "../workerd/Config.ts";

export const formatInternalWorkerModules = (worker: {
  modules: Record<string, string>;
}): Array<WorkerdConfig.Worker_Module> =>
  Object.entries(worker.modules).map(([name, content]) => ({
    name,
    esModule: content,
  }));

export const formatExtensionModule = (worker: { modules: Record<string, string> }): string => {
  const entries = Object.entries(worker.modules);
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one module, got ${entries.length}`);
  }
  return entries[0][1];
};

export const moduleToWorkerd = (module: Module): WorkerdConfig.Worker_Module => {
  switch (module.type) {
    case "ESModule":
      return { name: module.name, esModule: module.content };
    case "CommonJsModule":
      return { name: module.name, commonJsModule: module.content };
    case "Text":
      return { name: module.name, text: module.content };
    case "Data":
      return { name: module.name, data: module.content };
    case "Wasm":
      return { name: module.name, wasm: module.content };
    case "Json":
      return { name: module.name, json: module.content };
    case "PythonModule":
      return { name: module.name, pythonModule: module.content };
    case "PythonRequirement":
      return { name: module.name, pythonRequirement: module.content };
  }
};
