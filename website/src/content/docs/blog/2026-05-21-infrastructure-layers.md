---
title: Layers, infrastructure behind a typed interface
date: 2026-05-21T21:00:00Z
excerpt: The Layers doc gets rewritten around a Worker-shaped encapsulation example, and there's a new step-by-step guide that walks `JobService` end-to-end with one diff per step — from contract to provided Layer.
---

An **Infrastructure Layer** packages cloud resources and
bindings behind a typed service. Code that depends on the
service stays cloud-agnostic; swapping the Layer swaps the
underlying resources, bindings, and runtime glue. The mechanism
has been there for a while —
[`v2.0.0-beta.43`](/blog/2026-05-21-beta-43) ships a focused
pass on the docs around it.

## Layers — refreshed doc

The Layers story got rewritten around how people actually reach
for them: not the leaky-`getJob` helper the old example used,
but a Worker handler welded to one cloud's binding.

[Layers](/concepts/layers) now opens with a Worker that calls
KV directly:

```typescript
Effect.gen(function* () {
  const kv = yield* Cloudflare.KVNamespaceBinding.bind(MyKV);

  return {
    fetch: Effect.gen(function* () {
      const job = yield* kv.get<Job>("job-1", "json");
      return HttpServerResponse.json(job);
    }),
  };
});
```

and walks through why that shape is the wrong abstraction
boundary (KV error, KV shape, KV binding all leaking into
`fetch`), then collapses the whole thing into a `JobService`
Layer the consumer never has to know is KV-backed. The init /
runtime phase split now lines up with how `Cloudflare.Worker`
is actually written, instead of the ad-hoc `getJob(id)` example
the old version used. ([#386](https://github.com/alchemy-run/alchemy-effect/pull/386))

## New guide: Building Infrastructure Layers

[`/guides/infrastructure-layers`](/guides/infrastructure-layers)
is the "now build one yourself" companion to the concept doc.
It walks `JobService` end-to-end — one heading, one diff, one
explanation per step.

### Define the service contract

```typescript
// src/JobService.ts
export class JobService extends Context.Service<
  JobService,
  {
    getJob(id: string): Effect.Effect<Job | null, never, Alchemy.RuntimeContext>;
    putJob(job: Job): Effect.Effect<void, never, Alchemy.RuntimeContext>;
  }
>()("JobService") {}
```

`Alchemy.RuntimeContext` on the return types marks the methods as
runtime-only. The compiler rejects any attempt to call them from a
deploy script.

### Declare the KV namespace inside the Layer

```diff lang="typescript"
 // src/JobService.KV.ts
+import * as Cloudflare from "alchemy/Cloudflare";

 export const JobServiceKV = Layer.effect(
   JobService,
   Effect.gen(function* () {
+    const Namespace = yield* Cloudflare.KVNamespace("Jobs");
     return {
       // ...
     };
   }),
 );
```

The KV namespace is a normal alchemy resource — it joins the
Stack when the Layer is provided.

### Bind the namespace

```diff lang="typescript"
   Effect.gen(function* () {
     const Namespace = yield* Cloudflare.KVNamespace("Jobs");
+    const kv = yield* Cloudflare.KVNamespaceBinding.bind(Namespace);
     return {
       // ...
     };
   }),
```

`KVNamespaceBinding.bind(Namespace)` is the binding API — wires
the namespace into the consuming Worker and returns a typed
client.

### Implement the methods

```diff lang="typescript"
     return {
       getJob: Effect.fn(function* (id: string) {
-        // TODO: read from KV
+        return yield* kv.get<Job>(id, "json");
       }),
       putJob: Effect.fn(function* (job: Job) {
-        // TODO: write to KV
+        yield* kv.put(job.id, JSON.stringify(job));
       }),
     };
```

The runtime callable's `RuntimeContext` requirement matches what
`JobService` declared. Type checked end-to-end.

### Provide the Layer

```diff lang="typescript"
 // src/Api.ts
 export default Cloudflare.Worker(
   "Api",
   { main: import.meta.filename },
   Effect.gen(function* () {
+    const jobs = yield* JobService;

     return {
       fetch: Effect.gen(function* () {
+        const job = yield* jobs.getJob("job-1");
+        return yield* HttpServerResponse.json(job);
       }),
     };
-  }),
+  }).pipe(
+    Effect.provide(
+      JobServiceKV.pipe(Layer.provide(Cloudflare.KVNamespaceBindingLive)),
+    ),
+  ),
 );
```

`Layer.provide` satisfies `JobServiceKV`'s dependency on
`KVNamespaceBinding` *privately*, so the consumer's required
context shrinks back to just `JobService`. Swap the
implementation for a DynamoDB-backed Layer, the consumer's
signature is unchanged. ([#383](https://github.com/alchemy-run/alchemy-effect/pull/383))

## Where to go next

- [Layers](/concepts/layers) — the refreshed encapsulation walkthrough
- [Building Infrastructure Layers](/guides/infrastructure-layers) — the new step-by-step guide
- [Binding](/concepts/binding) — what `.bind(...)` does under the hood
- [Phases](/concepts/phases) — when init vs runtime code runs
- [Circular Bindings](/guides/circular-bindings) — two Layers referencing each other
