# Edge and DNS Deployment Contract

R2 does not require Cloudflare specifically, but this directory records the expected behavior when Cloudflare or an equivalent edge is used.

Required public-origin behavior:

- TLS is mandatory
- WebSocket upgrades for `/api` must pass through unchanged
- do not cache `/api/*`
- do not cache authenticated responses
- service worker and HTML remain revalidatable
- fingerprinted `/assets/*` may use immutable caching
- preserve the repository-controlled CSP, HSTS, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, and frame protections
- do not inject third-party JavaScript into the trusted application origin
- configure the web adapter's `WEB_TRUSTED_PROXY` only for the exact ingress IP/CIDR that connects directly to it

The deployed public origin must pass the repository public-origin header verification before Stable Release.
