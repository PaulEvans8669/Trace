# Contributing to Trace

Thanks for your interest in Trace. Issues, bug reports and pull requests are welcome.

Please read the contribution terms below before opening a pull request — they differ from the
usual open-source defaults, because Trace is source-available rather than open source.

## Contribution terms

**By submitting a pull request to this repository, you agree that:**

1. Your contribution is licensed under the [PolyForm Perimeter License 1.0.1](LICENSE), the same
   licence as the rest of the project; **and**
2. You grant the project maintainer (Paul Evans) a perpetual, worldwide, non-exclusive,
   no-charge, royalty-free, irrevocable copyright licence to reproduce, prepare derivative works
   of, publicly display, publicly perform, sublicense and distribute your contribution and such
   derivative works, **including the right to commercialise it and to relicense it under
   different terms**, including proprietary or commercial terms; **and**
3. You grant the maintainer a perpetual, worldwide, non-exclusive, no-charge, royalty-free,
   irrevocable patent licence to make, use, sell, offer for sale, import and otherwise transfer
   your contribution, covering only the patent claims you can license that are necessarily
   infringed by your contribution; **and**
4. You represent that you are legally entitled to grant the above — that the contribution is
   your original work, and that no employer, client or other third party holds rights in it that
   would prevent the grant. If your employer has rights to intellectual property you create,
   you confirm you have permission to contribute on their behalf.

### Why this is necessary

Under a permissive licence such as MIT, "inbound equals outbound" is the customary assumption:
contributions arrive under the same terms the project gives out. That assumption is not safe
under a source-available licence. You own the copyright in the code you write, and if you only
licensed it to the project under the Perimeter terms, the maintainer would **not** hold the
rights needed to include your lines in a future paid or freemium version of Trace. Clause 2
closes that gap.

This is a lightweight alternative to a signed Contributor License Agreement. It is standard
practice for source-available projects, and the PolyForm project itself uses the same approach.

If you are not comfortable with these terms, please open an issue describing the change instead
of a pull request — a clear bug report is genuinely valuable.

## Getting set up

```bash
npm install
npm run verify   # lint + typecheck + test
```

Requirements:

- **Node.js 24** — matches the `nodejs24.x` runtime in `manifest.yml`. Building against another
  major version risks passing locally and failing in the Forge sandbox.
- **Forge CLI** — `npm install -g @forge/cli`, then `forge login`. Only needed to run the app.
- An Atlassian Cloud site with both Jira and Confluence, if you want to run it live. See
  [Getting started](README.md#getting-started) in the README.

## Before you open a pull request

- [ ] `npm run verify` passes (lint, typecheck, tests). CI runs the same gate and blocks merge.
- [ ] New or changed behaviour has a test next to the unit it covers
      (`linkStatus.ts` / `linkStatus.test.ts`), not in a parallel `__tests__` tree.
- [ ] Documentation is updated if the change affects setup, the workflow, the resolver surface
      or the permissions table.
- [ ] If the change touches what data is stored or which scopes are requested,
      [`PRIVACY.md`](PRIVACY.md) is updated to match. This is not optional — the policy is a
      published statement about the app's behaviour.

## House rules

These are enforced by tooling, so it is quicker to know them up front than to discover them in
CI. The reasoning behind each is in the
[Key decisions](README.md#key-decisions) section of the README.

- **Only `@forge/react` components render.** Standard DOM elements (`div`, `span`, `strong`) and
  third-party React component libraries break the panels at runtime, not at build time.
- **`any` is a lint error.** TypeScript runs with `strict`, `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`, so indexed access yields `T | undefined` and needs narrowing.
- **Presentational components may not import from `containers/`, `hooks/` or `services/`.** An
  ESLint `no-restricted-imports` rule scoped to `src/frontend/features/**/components/**`
  enforces it.
- **Migrations are append-only.** Never rename, reorder or delete an entry in
  `src/migrations/index.ts`. Installations track applied migrations by name, so removing one
  leaves them permanently inconsistent. See
  [Adding a migration](README.md#adding-a-migration).
- **The workflow lives in `src/shared/linkStatus.ts`.** Both the resolver and the UI import it,
  so the backend enforces exactly the transitions the UI offers. Change it there, once.
- **Resolvers return an envelope**, `{ ok: true, data }` or `{ ok: false, code, message }` —
  never a thrown error, whose custom fields are not guaranteed to survive Forge's `invoke`
  bridge.
- **Every read path filters rows against the product.** Forge SQL is app-scoped and has no
  permissions of its own; skipping the filter would let a user enumerate issue keys attached to
  pages they cannot read.

## Commit and pull request style

- Keep pull requests focused on a single concern; small reviewable changes get merged faster.
- Explain *why* in the description, not just *what* — the diff already says what.
- Reference the issue the pull request addresses, if there is one.

## Reporting security issues

Please do **not** open a public issue for a security vulnerability. Email
paul.evans8669@protonmail.com instead.

## Licence

Trace is distributed under the [PolyForm Perimeter License 1.0.1](LICENSE). You may use, modify,
fork and self-host it for any purpose, including commercially within your own organisation, but
you may not use it to provide others with a product that competes with Trace. For a licence
covering competing use, contact the maintainer.
