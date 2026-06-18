/**
 * Placeholder entrypoint for the cloudflared ECS task. `AWS.ECS.Task` requires
 * a `main`, but the task's Docker image is built from `cloudflared/Dockerfile`
 * (`FROM cloudflare/cloudflared`), whose ENTRYPOINT runs the connector — this
 * bundled module is never executed.
 */
export default {};
