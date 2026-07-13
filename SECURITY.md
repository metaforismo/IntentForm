# Security Policy

Please report vulnerabilities privately through GitHub Security Advisories once the public repository is available. Do not open a public issue for credentials, code execution, quota bypass or supply-chain findings.

Current security boundaries:

- API credentials belong only in server environment variables.
- Graph expressions cannot contain arbitrary JavaScript.
- Model output is untrusted and schema-validated.
- Generated paths are compiler-owned and bounded.
- Anonymous live-model access is quota-limited; deterministic replay is the fallback.

IntentForm is pre-release software and should not be used to process production financial or personal data.
