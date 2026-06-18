/**
 * Shared stack names + the Hyperdrive logical id. The app stack's Worker binds
 * the Hyperdrive by reference into the infra stack, so both sides must agree on
 * these strings. Keeping them in a string-only module lets the Worker reference
 * the infra resources without importing any AWS code into its bundle.
 */
export const PUBLIC_INFRA_STACK = "CfAuroraHyperdrivePublicInfra";
export const PUBLIC_APP_STACK = "CfAuroraHyperdrivePublicApp";
export const HYPERDRIVE_ID = "AppHyperdrive";

export const TUNNEL_INFRA_STACK = "CfAuroraHyperdriveTunnelInfra";
export const TUNNEL_APP_STACK = "CfAuroraHyperdriveTunnelApp";
export const TUNNEL_HYPERDRIVE_ID = "AppTunnelHyperdrive";
