# cloudflared connector for the Tunnel path. The official image's ENTRYPOINT is
# `cloudflared --no-autoupdate`; `tunnel run` reads the connector token from the
# TUNNEL_TOKEN environment variable injected by the ECS task definition.
FROM --platform=linux/amd64 cloudflare/cloudflared:latest
CMD ["tunnel", "run"]
