import * as Effect from "effect/Effect";
import type { BindingHook } from "../PluginContext";

export const local = (name: string, text: string): BindingHook =>
  Effect.succeed({
    name,
    text,
  });
