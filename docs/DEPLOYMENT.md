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

The seven isolated scenarios exercise the semantic canvas, fixture editing, active React flow, keyboard navigation, adaptive and compact layouts, reduced motion, slow/failed request recovery, direct routes, refresh and invalid inputs from fresh browser contexts. They fail on unexpected console errors, page errors or failed requests and verify the production CSP/security headers. On failure, named screenshots and a Playwright trace are written under `output/playwright/failures/`.

Before marking the submission checklist complete, confirm that the URL returns the Studio without an SSO redirect. Deployment protection must be changed only for the IntentForm project and only with explicit owner approval.

Current production target: [intentform-metaforismos-projects.vercel.app](https://intentform-metaforismos-projects.vercel.app). At the latest verified checkpoint it returned a Vercel team-SSO redirect, so the public-access checkbox remains open.

After any protection change, verify all of the following from a clean browser and the exact deployed revision:

```bash
curl -I https://intentform-metaforismos-projects.vercel.app
STUDIO_ORIGIN=https://intentform-metaforismos-projects.vercel.app pnpm smoke:studio
```

The first response must reach IntentForm rather than `vercel.com/sso-api`; the second command must pass all seven scenarios with no unexpected browser errors. Keep `OPENAI_API_KEY` unset for the public replay deployment.
