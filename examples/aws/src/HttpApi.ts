import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Schema as S } from "effect";
import { HttpRouter } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { createServer } from "node:http";

// Define our API with one group named "Greetings" and one endpoint called "hello-world"
const MyApi = HttpApi.make("MyApi").add(
  HttpApiGroup.make("Greetings").add(
    HttpApiEndpoint.get("hello-world", "/", {
      success: S.String,
    }),
  ),
);

// Implement the "Greetings" group
const GreetingsLive = HttpApiBuilder.group(MyApi, "Greetings", (handlers) =>
  handlers.handle("hello-world", () => Effect.succeed("Hello, World!")),
);

// Provide the implementation for the API

const MyApiLive = HttpApiBuilder.layer(MyApi).pipe(
  Layer.provideMerge(GreetingsLive),
);

HttpRouter.toHttpEffect(MyApiLive);

// Set up the server using NodeHttpServer on port 3000
const ServerLive = HttpApiBuilder.layer(MyApi).pipe(
  Layer.provide(MyApiLive),
  Layer.provide(HttpRouter.layer),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);

// Launch the server
Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
