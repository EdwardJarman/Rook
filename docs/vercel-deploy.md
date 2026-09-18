# Deploying Rook to Vercel

The Vercel project `rook-lighting` is not connected to the GitHub repo for
auto-deploy. This is by design for now (manual deploys let you stage
changes), but it means **nothing deploys until someone runs the deploy
command**. The release workflow builds the desktop installers; the Vercel
deploy serves the web app + tRPC api.

## One-time setup

1. **Log in to Vercel** (opens a browser):
   ```bash
   pnpm exec vercel login
   ```

2. **Link this repo to the Vercel project** (one-time, interactive):
   ```bash
   pnpm exec vercel link
   ```
   - "Set up and deploy?" → **No** (we'll deploy manually after committing)
   - "Which scope?" → your personal account (the one that owns rook-lighting)
   - "Link to existing project?" → **Yes**
   - "Project name?" → **`rook-lighting`**
   - "In which directory is your code located?" → **`./`**

   This writes `.vercel/project.json` and `.vercel/prefer-json` (both are
   gitignored). The next deploy will use these.

## Deploying

```bash
pnpm vercel:deploy
```

This is a thin wrapper around `vercel deploy --prod` (see
`scripts/vercel-deploy.mjs`). It runs `pnpm vercel-build` automatically
via the `buildCommand` in `vercel.json`, which produces the static
`dist/` and bundles the api serverless function.

## Or: connect git for auto-deploy

If you'd rather have every push to `main` auto-deploy to Vercel:

1. Open https://vercel.com/rooks-projects/rook-lighting/settings/git
2. "Connect Git Repository" → pick `EdwardJarman/Rook` → Production Branch `main`
3. Save.

From that point on, every push to `main` triggers a fresh Vercel
deployment. The `pnpm vercel:deploy` script becomes optional.

## CI-only token (for headless deploys)

If you want to deploy from CI (e.g. after the release workflow finishes
the desktop installers), create a token at
https://vercel.com/account/tokens and add it as a GitHub Actions secret
named `VERCEL_TOKEN`. Then a one-liner job like:

```yaml
- run: pnpm vercel:deploy
  env:
    VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
    VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

…will deploy from CI. The CLI reads those three env vars automatically.
