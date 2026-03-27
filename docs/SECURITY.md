# HTTP Security

[← Back to docs](README.md) · [Security Policy](../SECURITY.md)

Flywheel's HTTP transport (`FLYWHEEL_TRANSPORT=http`) has **no built-in authentication or TLS**. By default, it binds to `127.0.0.1:3111` — only processes on the same machine can reach it. This is safe for local development, but if you need remote access (multi-machine setups, remote agents), you must put a reverse proxy in front.

> **Do not expose the HTTP transport to the network without a reverse proxy providing TLS and authentication.** Any client that can reach the port can call every tool — including write operations.

---

## nginx

```nginx
# /etc/nginx/sites-available/flywheel
limit_req_zone $binary_remote_addr zone=flywheel:10m rate=30r/m;

server {
    listen 443 ssl;
    server_name flywheel.example.com;

    # --- TLS termination ---
    ssl_certificate     /etc/ssl/certs/flywheel.pem;
    ssl_certificate_key /etc/ssl/private/flywheel.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # --- MCP endpoint ---
    location /mcp {
        limit_req zone=flywheel burst=10 nodelay;

        # Flywheel stays on localhost — never change this
        proxy_pass http://127.0.0.1:3111;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for streaming MCP responses
        proxy_buffering off;

        # Add your auth layer here (e.g., auth_basic, auth_request, or mTLS)
    }

    # --- Health check (no rate limit) ---
    location /health {
        proxy_pass http://127.0.0.1:3111;
    }
}
```

Enable with:

```bash
ln -s /etc/nginx/sites-available/flywheel /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Caddy

```caddyfile
flywheel.example.com {
    # Caddy provisions TLS automatically via Let's Encrypt

    @mcp path /mcp
    handle @mcp {
        reverse_proxy localhost:3111 {
            flush_interval -1   # Stream responses immediately
        }
        # Add your auth layer here (e.g., basicauth, forward_auth)
    }

    handle /health {
        reverse_proxy localhost:3111
    }
}
```

Start with:

```bash
caddy run --config /etc/caddy/Caddyfile
```

Caddy handles TLS certificate provisioning, renewal, and OCSP stapling automatically. No certificate paths needed unless you supply your own.

---

## Before you deploy

- [ ] `FLYWHEEL_HTTP_HOST` is `127.0.0.1` (the default — never change it)
- [ ] Reverse proxy terminates TLS (self-signed is fine for internal use)
- [ ] Auth layer is in place (basic auth, mTLS, OAuth proxy, etc.)
- [ ] Rate limiting is configured to prevent abuse
- [ ] Test: `curl -s https://flywheel.example.com/health` returns version info
- [ ] Test: unauthenticated requests are rejected by your proxy
