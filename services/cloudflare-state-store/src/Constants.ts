/**
 * Deployment-time constants shared between the state-store worker
 * resource (which sets its Cloudflare script name) and the login
 * flow (which derives the service URL from that same name).
 */

/**
 * Fixed Cloudflare Worker script name. Bypasses alchemy's default
 * physical-name generation so the deployed URL is predictable:
 *
 *   `https://alchemy-state-store.{subdomain}.workers.dev`
 *
 * Because the name is hardcoded, only one state-store deployment per
 * Cloudflare account is supported today. Multiple stages on one
 * account would collide.
 */
export const STATE_STORE_SCRIPT_NAME = "alchemy-state-store" as const;

/**
 * Logical id (and therefore the Cloudflare Secrets Store secret name)
 * of the bearer token the worker authenticates against. The
 * `Cloudflare.Secret` provider uses the logical id as the secret
 * name when `props.name` is omitted, so the constant is the
 * authoritative reference for both the server (which creates it) and
 * the Cloudflare login flow (which reads it back via an edge probe).
 */
export const STATE_STORE_AUTH_TOKEN_SECRET_NAME =
  "StateStoreAuthToken" as const;
