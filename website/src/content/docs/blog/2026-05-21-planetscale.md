---
title: PlanetScale, branched per PR
date: 2026-05-21T20:00:00Z
excerpt: PlanetScale lands as a first-class provider — `MySQLDatabase` / `PostgresDatabase`, branches, credentials, and a Drizzle integration that plugs straight into Cloudflare Hyperdrive. We walk the resource graph end-to-end, including the `.ref()` pattern for branching off a centralised staging database.
---

`alchemy/Planetscale` is the new provider in
[`v2.0.0-beta.43`](/blog/2026-05-21-beta-43) — both MySQL and
the new Postgres engine, with branches, credentials, and a
Drizzle workflow that wires straight into Cloudflare Hyperdrive.
We'll walk the resource graph one step at a time, and finish on
the `.ref()` pattern that lets PR-preview stages fork off a
long-lived staging database without re-provisioning it.

## PlanetScale, planet-scale

Both engines mirror each other one-for-one:

| MySQL                       | Postgres                       |
| --------------------------- | ------------------------------ |
| `Planetscale.MySQLDatabase` | `Planetscale.PostgresDatabase` |
| `Planetscale.MySQLBranch`   | `Planetscale.PostgresBranch`   |
| `Planetscale.MySQLPassword` | `Planetscale.PostgresRole`     |

The walkthrough below uses Postgres, since the new
[`alchemy/Drizzle`](#step-7-drizzlepostgres-effect-native-drizzle-on-hyperdrive)
helper is Postgres-shaped. The MySQL deltas are noted along the way.

### Step 1 — register the provider

```diff lang="typescript"
 // alchemy.run.ts
 import * as Alchemy from "alchemy";
 import * as Cloudflare from "alchemy/Cloudflare";
+import * as Planetscale from "alchemy/Planetscale";
+import * as Layer from "effect/Layer";

 export default Alchemy.Stack(
   "App",
   {
-    providers: Cloudflare.providers(),
+    providers: Layer.mergeAll(
+      Cloudflare.providers(),
+      Planetscale.providers(),
+    ),
     state: Alchemy.localState(),
   },
   // ...
 );
```

`Planetscale.providers()` adds the deploy-time policy bindings for
every PlanetScale resource and registers the auth step. The next
`bun alchemy login` either reads `PLANETSCALE_API_TOKEN_ID`,
`PLANETSCALE_API_TOKEN`, and `PLANETSCALE_ORGANIZATION` from the
environment (CI) or stores them under
`~/.alchemy/credentials/<profile>/planetscale-stored.json`.

### Step 2 — declare the database

```diff lang="typescript"
 // src/Db.ts
+import * as Planetscale from "alchemy/Planetscale";
+import * as Effect from "effect/Effect";

+export const Db = Effect.gen(function* () {
+  const database = yield* Planetscale.PostgresDatabase("app-db", {
+    region: { slug: "us-east" },
+    clusterSize: "PS_10",
+  });
+
+  return { database };
+});
```

`Planetscale.PostgresDatabase` is the long-lived cluster — the
control-plane entity that owns the actual storage, replicas, and
region. `region` and `arch` are stable: changing either triggers
a replacement, not an in-place update. `clusterSize` is mutable
and gets resized in place.

(For MySQL, swap `PostgresDatabase` → `MySQLDatabase`. The shape
is identical.)

### Step 3 — branch off it

```diff lang="typescript"
 export const Db = Effect.gen(function* () {
   const database = yield* Planetscale.PostgresDatabase("app-db", {
     region: { slug: "us-east" },
     clusterSize: "PS_10",
   });

+  const branch = yield* Planetscale.PostgresBranch("app-branch", {
+    database,
+  });

-  return { database };
+  return { database, branch };
 });
```

`Planetscale.PostgresBranch` is the per-environment fork. Branches
are cheap — fork main, get an isolated copy of the schema, point
your Worker at it, throw it away on PR close. This is the unit
you actually deploy against.

For MySQL, the branch takes one extra flag: `isProduction:
false` for ephemeral branches, `true` for the production branch.

### Step 4 — mint credentials

```diff lang="typescript"
   const branch = yield* Planetscale.PostgresBranch("app-branch", {
     database,
   });

+  const role = yield* Planetscale.PostgresRole("app-role", {
+    database,
+    branch,
+    inheritedRoles: ["postgres"],
+  });

-  return { database, branch };
+  return { database, branch, role };
 });
```

`Planetscale.PostgresRole` materialises a real Postgres role with
`GRANT`s from `inheritedRoles`. Its `password` is `Redacted`
end-to-end — it never lands in plan output, state files, or
serialised events.

The role exposes an `origin` attribute:

```typescript
role.origin: {
  scheme: "postgres" | "postgresql";
  host: string;
  port: number;
  database: string;
  user: string;
  password: Redacted.Redacted<string>;
};
```

This is the exact shape `Cloudflare.Hyperdrive` accepts as its
`origin` input — the two pieces are designed to snap together.

(MySQL has the analogous `Planetscale.MySQLPassword` with `role:
"reader" | "writer" | "admin" | "readwriter"` and a matching
`origin` whose `scheme` is `"mysql"`.)

### Step 5 — put Hyperdrive in front

```diff lang="typescript"
 // src/Db.ts
+import * as Cloudflare from "alchemy/Cloudflare";

 // ...

+export const Hyperdrive = Effect.gen(function* () {
+  const { role } = yield* Db;
+  return yield* Cloudflare.Hyperdrive("app-hyperdrive", {
+    origin: role.origin,
+  });
+});
```

`Cloudflare.Hyperdrive` is Cloudflare's edge-pooled connection
proxy. Because `role.origin` is an `Output`, alchemy automatically
orders the deploy graph: `PostgresDatabase` → `PostgresBranch` →
`PostgresRole` → `Hyperdrive` → `Worker`. No explicit `dependsOn`,
no `await`s — the graph follows the dataflow.

For MySQL, pass `password.origin` instead. Hyperdrive sees
`scheme: "mysql"` and provisions a MySQL pooler.

### Step 6 — bind Hyperdrive into the Worker

```diff lang="typescript"
 // src/Api.ts
 import * as Cloudflare from "alchemy/Cloudflare";
 import * as Effect from "effect/Effect";
+import { Hyperdrive } from "./Db.ts";

 export default class Api extends Cloudflare.Worker<Api>()(
   "Api",
   { main: import.meta.filename },
   Effect.gen(function* () {
+    const conn = yield* Cloudflare.Hyperdrive.bind(Hyperdrive);

     return {
       fetch: Effect.gen(function* () {
         // ...
       }),
     };
-  }),
+  }).pipe(Effect.provide(Cloudflare.HyperdriveBindingLive)),
 ) {}
```

`Cloudflare.Hyperdrive.bind(Hyperdrive)` is the binding API. Two
things happen at once:

- At **deploy time** the policy half of the binding records a
  Hyperdrive binding on the Worker config (the same plumbing as
  `wrangler`'s `[[hyperdrive]]` block, but typed).
- At **runtime** `conn.connectionString` resolves to a `Redacted`
  string driving the pooled edge endpoint.

`Cloudflare.HyperdriveBindingLive` is the runtime layer that
satisfies `Cloudflare.HyperdriveBinding`'s requirement on
`WorkerEnvironment`. Provide it once at the Worker boundary;
nothing downstream has to know.

### Step 7 — `Drizzle.postgres`: Effect-native Drizzle on Hyperdrive

```diff lang="typescript"
 import * as Cloudflare from "alchemy/Cloudflare";
+import * as Drizzle from "alchemy/Drizzle";
 import * as Effect from "effect/Effect";
+import { relations, Users } from "./schema.ts";
 import { Hyperdrive } from "./Db.ts";

 Effect.gen(function* () {
   const conn = yield* Cloudflare.Hyperdrive.bind(Hyperdrive);
+  const db = yield* Drizzle.postgres(conn.connectionString, { relations });

   return {
     fetch: Effect.gen(function* () {
-      // ...
+      const users = yield* db.select().from(Users);
+      return yield* HttpServerResponse.json({ users });
     }),
   };
 })
```

`Drizzle.postgres` is the new helper in `alchemy/Drizzle`. It
returns a chainable proxy over `EffectPgDatabase` — every method
call builds an Effect, so `db.select().from(Users)` is just
`yield*`-able, no `Effect.tryPromise` wrapper required. Errors
land on the Effect error channel.

The connection pool is materialised lazily against an isolated,
never-closing `Scope`. Translation: one pool per JS realm,
shared across requests, and `Cloudflare.Worker`'s
`Effect.scoped` boundary doesn't tear it down between fetches.

(MySQL pairs with `mysql2` directly:
`drizzle(Redacted.value(connectionString), { schema, relations,
mode: "default" })` inside the `fetch` body, one connection per
request. There's no `Drizzle.mysql` helper yet.)

### Step 8 — `Drizzle.Schema`: migrations as a resource

```diff lang="typescript"
 // src/Db.ts
+import * as Drizzle from "alchemy/Drizzle";

 export const Db = Effect.gen(function* () {
+  const schema = yield* Drizzle.Schema("app-schema", {
+    schema: "./src/schema.ts",
+    out: "./migrations",
+  });

   const database = yield* Planetscale.PostgresDatabase("app-db", { /* ... */ });

   const branch = yield* Planetscale.PostgresBranch("app-branch", {
     database,
+    migrationsDir: schema.out,
   });
   // ...
 });
```

`Drizzle.Schema` wraps drizzle-kit's programmatic API as an
alchemy resource. On every deploy it:

1. Imports `./src/schema.ts` and compares it to the latest
   snapshot under `out`.
2. If the schema has drifted, writes a new
   `{timestamp}_migration/` directory containing `migration.sql`
   and `snapshot.json`.

Wiring `schema.out` into `PostgresBranch.migrationsDir` turns it
into a dataflow edge: alchemy orders `Drizzle.Schema` before the
branch, and the branch then scans the directory and applies any
new SQL files transactionally against its own connection. One
deploy, schema → migration files → applied migrations.

Don't forget to register the Drizzle provider:

```diff lang="typescript"
 providers: Layer.mergeAll(
   Cloudflare.providers(),
+  Drizzle.providers(),
   Planetscale.providers(),
 ),
```

The same flow against Neon is the subject of the
[Drizzle tutorial](/tutorial/cloudflare/drizzle) — PlanetScale's
`PostgresBranch.migrationsDir` slots into the same shape.

### Step 9 — `.ref()`: fork from a centralised staging database

The walkthrough so far creates a fresh `PostgresDatabase` every
deploy. That's fine for `dev_<user>` and for the long-lived
`prod` stage, but it's wrong for PR previews — spinning up a
new Postgres cluster per PR is slow, expensive, and out of step
with how PlanetScale itself thinks about branching.

The pattern the [example](https://github.com/alchemy-run/alchemy-effect/tree/main/examples/cloudflare-planetscale-postgres-drizzle)
uses splits stages into two tiers:

- **`staging-*` stages own the long-lived database.** They run on
  PR open (creating `staging-pr-123` for PR #123) and on push to
  main (creating `staging-main`). They provision
  `PostgresDatabase`, nothing else cheap depends on them.
- **`pr-*` stages own ephemeral compute.** They reference the
  `staging-pr-*` database via `.ref()` and provision only the
  per-PR branch, role, Hyperdrive, and Worker.

The fork point is one ternary in `Db.ts`:

```diff lang="typescript"
 export const Db = Effect.gen(function* () {
+  const { stage } = yield* Alchemy.Stack;

-  const database = yield* Planetscale.PostgresDatabase("app-db", {
-    region: { slug: "us-east" },
-    clusterSize: "PS_10",
-  });
+  const database = stage.startsWith("pr-")
+    ? yield* Planetscale.PostgresDatabase.ref("app-db", {
+        stage: `staging-${stage}`,
+      })
+    : yield* Planetscale.PostgresDatabase("app-db", {
+        region: { slug: "us-east" },
+        clusterSize: "PS_10",
+      });
   // branch / role / hyperdrive stay the same — they all
   // depend on `database` either way.
 });
```

`PostgresDatabase.ref("app-db", { stage })` is the new piece.
Every resource type on alchemy gets a `.ref()` constructor that
reads the resource's output attributes from another stage's
state instead of provisioning a new one. The returned value has
the same `PostgresDatabase` type — downstream code (the branch,
the role, the Hyperdrive) can't tell the difference between an
owned database and a referenced one.

Concretely, when stage `pr-123` deploys:

1. `staging-pr-123` has already run (triggered by `pr open`)
   and owns the long-lived `PostgresDatabase`.
2. `pr-123` calls `PostgresDatabase.ref("app-db", { stage:
   "staging-pr-123" })` and gets a handle to that database.
3. Everything else — `PostgresBranch`, `PostgresRole`,
   `Hyperdrive`, `Worker` — is created fresh in the `pr-123`
   stage's namespace and torn down when the PR closes.

Locally (`dev_<user>`) and in prod (`prod`), the `else` branch
runs and you own your own database. Same code, three different
deployment topologies.

This is the **planet-scale** part of "planet-scale resources".
PlanetScale already separates the cluster (multi-region storage)
from the branch (cheap fork). Alchemy mirrors that on the
control-plane side: the cluster is owned in one stage, the
branches are owned in many, and `.ref()` is the glue.

The same mechanism applied to Neon is the subject of the
[Branch from a shared database](/tutorial/cloudflare/branch-from-shared-database)
tutorial and the [Shared database](/guides/shared-database)
guide — `Resource.ref(id, { stage })` is the cross-stage
reference, regardless of provider.

## Where to go next

- [Hyperdrive tutorial](/tutorial/cloudflare/neon-hyperdrive) — now with PlanetScale Postgres and MySQL as side-by-side tabs alongside Neon
- [Drizzle tutorial](/tutorial/cloudflare/drizzle) — `Drizzle.Schema` and deploy-driven migrations
- [Branch from a shared database](/tutorial/cloudflare/branch-from-shared-database) — the `.ref()` pattern as a guided tutorial
- [Shared database guide](/guides/shared-database) — the reference for cross-stage references
- [PlanetScale Postgres + Drizzle example](https://github.com/alchemy-run/alchemy-effect/tree/main/examples/cloudflare-planetscale-postgres-drizzle)
- [PlanetScale MySQL + Drizzle example](https://github.com/alchemy-run/alchemy-effect/tree/main/examples/cloudflare-planetscale-mysql-drizzle)
- [#113 — feat(planetscale): add planetscale resources](https://github.com/alchemy-run/alchemy-effect/pull/113)
