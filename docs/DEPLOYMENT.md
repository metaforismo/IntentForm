# Deployment

IntentForm deploys from the monorepo root. `vercel.json` runs the same frozen-lockfile install and production build used locally, then serves the Next.js output from `apps/studio-web/.next`.

## Judge-safe default

The public Build Week deployment is replay-first:

- do not configure `OPENAI_API_KEY` for the initial public smoke test;
- no login or user-supplied key is required;
- brief interpretation, semantic edits and deterministic repairs remain demonstrable;
- the Studio always labels the result as `Deterministic replay` rather than presenting it as a live model run.

This is the safe public baseline. A live key may be added later only with a persistent shared quota store and a provider-level spend limit. The in-process quota in `apps/studio-web/lib/quota.ts` is defense in depth for a single process; it is not a global serverless budget.

## Deploy

```bash
vercel deploy
```

For the final production alias:

```bash
vercel deploy --prod
```

The repository is connected to the `intentform` Vercel project, so pushes to the configured production branch can also build through Git integration. `.vercelignore` excludes local graphs, revision history, build caches, native DerivedData, evidence and secrets.

## Remote smoke test

Run the complete browser suite against a deployed URL instead of starting a local server:

```bash
STUDIO_ORIGIN=https://your-deployment.example pnpm smoke:studio
```

The gate exercises the semantic canvas, fixture editing, shared device verification, generated React flow, flow editing, adaptive panels and replay disclosure from a clean browser context.

Before marking the submission checklist complete, confirm that the URL returns the Studio without an SSO redirect. Deployment protection must be changed only for the IntentForm project and only with explicit owner approval.
