import * as Effect from "effect/Effect";

import * as Lambda from "distilled-aws/lambda";
import { Binding } from "../../Binding.ts";
import { declare, type Capability, type On } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Function } from "./Function.ts";

export interface InvokeFunction<Resource = unknown> extends Capability<
  "AWS.Lambda.InvokeFunction",
  Resource
> {}

export const InvokeFunction = Binding("AWS.Lambda.InvokeFunction")<
  <F extends Function>(func: F) => InvokeFunction<On<F>>
>();

export const invokeFunction = Effect.fnUntraced(function* <F extends Function>(
  func: F,
  input: any,
) {
  const functionArn = process.env[`${func.id}-functionArn`]!;
  yield* declare<InvokeFunction<F>>();
  return yield* Lambda.invoke({
    FunctionName: functionArn,
    InvocationType: "RequestResponse",
    Payload: JSON.stringify(input),
  });
});

export const invokeFunctionFromLambda = InvokeFunction.provider.succeed({
  attach: ({ source: func }) => ({
    env: {
      [toEnvKey(func.id, "FUNCTION_ARN")]: func.attr.functionArn,
    },
    policyStatements: [
      {
        Sid: "AWS.Lambda.InvokeFunction",
        Effect: "Allow",
        Action: ["lambda:InvokeFunction"],
        Resource: [func.attr.functionArn],
      },
    ],
  }),
});
