# Security Policy

Please report vulnerabilities privately through GitHub Security Advisories once the public repository is available. Do not open a public issue for credentials, code execution, quota bypass or supply-chain findings.

Current security boundaries:

- API credentials belong only in server environment variables.
- Graph expressions cannot contain arbitrary JavaScript.
- Model output is untrusted and schema-validated.
- Generated paths are compiler-owned and bounded.
- Anonymous live-model access is quota-limited; deterministic replay is the fallback.
- Hosted project-file writes fail closed; the project API is local-only unless explicitly enabled in a non-Vercel production environment.
- Production responses enforce a same-origin CSP, framing policy, restricted browser permissions, strict referrers and content-type sniffing protection.
- Active preview messages and fingerprints are validated, and the iframe does not receive same-origin capability.

The public deployment must remain replay-only until quotas are durable across instances. The repository's local secret-pattern scan is not a substitute for a supply-chain advisory service; the production dependency audit remains unverified until the owner explicitly authorizes sending dependency metadata to npm.

IntentForm is pre-release software and should not be used to process production financial or personal data.
