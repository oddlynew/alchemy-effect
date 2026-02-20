import type { HttpClient } from "@effect/platform/HttpClient";
import type { Credentials } from "distilled-aws/Credentials";
import type { Region } from "distilled-aws/Region";
import * as Layer from "effect/Layer";

export declare const node22: Layer.Layer<
  Credentials | Region | HttpClient,
  never,
  never
>;
