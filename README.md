# Trace

**Keep your documentation up to date as your product evolves.**

Trace connects Jira issues to Confluence pages and tracks whether the documentation has been updated to match. It answers a simple question: when something changes in your product, which documentation pages need updating, and has anyone done it yet?

---

**Quick links:**
- [Terms of Service](TERMS.md)
- [Licence and Contributing](CONTRIBUTING.md)
- [Privacy Policy](PRIVACY.md)
- [Developer Setup](#for-developers)

---

## The Problem

When a feature ships, the documentation it affects often sits unchanged until someone—or no one—remembers to update it. By then, users are frustrated or making wrong assumptions.

Trace fixes this by linking the work directly to the docs and tracking progress through a simple status workflow. So nothing slips through the cracks.

## How It Works

### In Jira
When you close an issue, Trace lets you link it to any Confluence page that needs documentation updates. You can search for pages right from the issue.

### In Confluence
When you read a page, Trace shows you all the Jira issues linked to it—and whether each one has been documented yet. You can update the status as you work.

### The Workflow
Each link has a simple status:
- **Not started** — someone needs to update the docs
- **Ongoing** — someone is working on it now
- **Needs review** — it's ready for someone else to check
- **Needs rework** — the reviewer wants changes
- **Done** — it's finished and approved

Trace records who moved the status forward and when, so you have a complete audit trail.

## What You Need

- An Atlassian Cloud site (Jira and/or Confluence)
- Jira (required) + Confluence (recommended—otherwise there's nothing to link to)

## Privacy

Trace stores only links, their status, and who changed them. No page content, no issue content, no personal data beyond the user account ID that's already in Atlassian. Everything is hosted by Atlassian in their data centers. No external servers, no analytics, no tracking. See [PRIVACY.md](PRIVACY.md) for details.

## Licence

Trace is source-available under the [PolyForm Perimeter License](LICENSE). You can use, modify, fork and self-host it freely—including in commercial environments—but you can't use it to build a competing product. If you want to contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

# For Developers

Everything below is technical documentation for developers building or extending Trace.

## Getting started

### Prerequisites

- **Node.js 24** - matches the `nodejs24.x` runtime declared in `manifest.yml`. Building against a
  different major risks passing locally and failing in the Forge sandbox.
- **Forge CLI** - `npm install -g @forge/cli`, then `forge login`.
- An Atlassian Cloud site with **both Jira and Confluence**. Jira is required
  (`compatibility.jira.required: true`); the Confluence byline item simply will not appear on sites
  without Confluence.

### First run

```bash
npm install
npm run verify                              # lint + typecheck + test
npm run deploy:dev
npm run install:dev --site=<your-site>.atlassian.net
```

`install:dev` installs into Jira. Install into Confluence separately to get the byline item:

```bash
forge install --non-interactive --site <your-site>.atlassian.net --product confluence --environment development
```

The app id in `manifest.yml` points at an existing Forge app. If you are working from a fork and
do not own that app, run `forge register` first to claim a fresh id.

### Local development

```bash
npx forge tunnel
```

The tunnel hot-reloads source changes, so editing anything under `src/` needs no redeploy. Changing
`manifest.yml` does: stop the tunnel, `npm run deploy:dev`, then start it again. Adding scopes also
requires an upgrade (`npm run install:dev:upgrade --site=...`) before the new permission takes
effect, and the site admin has to approve it.

Note that the tunnel still talks to the **deployed** Forge SQL database for the development
environment - there is no local database, so migrations you add are exercised against real data.

## Architecture

```
src/
  shared/           Platform-free code imported by BOTH bundles (workflow state machine,
                    error envelope contract).
  backend/
    clients/        Thin REST wrappers (jiraClient, confluenceClient). All asUser().
    services/       Business rules, validation and permission filtering.
    repositories/   Forge SQL data access. No REST calls, no business rules.
    types/          Payload, record and view-model contracts.
    utils/          Forge SQL wrapper with structured error logging.
  resolver/         Resolver definitions. Thin - they forward to services and wrap the result.
  triggers/         Product trigger handlers (cleanup after page/issue deletion).
  migrations/       Forge SQL schema migrations, applied by the install/upgrade trigger.
  frontend/
    shared/         The resolver client (envelope unwrapping), shared formatting, and the
                    presentational components used by both panels.
    features/<feature>/
      containers/   Wire a hook to a component.
      components/   Presentational only - no imports from hooks/services (ESLint enforced).
      hooks/        State and effects, exposed as a single view model.
      services/     All resolver/`view` calls plus response normalization.
      types/        Feature contracts.
```

### Key decisions

- **The workflow lives in `src/shared/linkStatus.ts`.** Both the resolver and the UI import it,
  so the backend enforces exactly the transitions the UI offers. The resolver rejects any
  transition that is not an edge in the state machine.
- **Resolver endpoints are shaped around views, not tables.** `getBylineView` and
  `getIssuePanelView` each return everything their panel renders, so a panel loads in one round
  trip. This is not just tidiness: the permission check has to fetch the page and the issues
  anyway, so returning that data is free. A table-shaped surface tempts the frontend into
  re-requesting data the backend already had.
- **Storage has no permissions of its own.** Forge SQL is app-scoped, so every read path
  filters rows against what the caller can actually see in Jira/Confluence before returning
  them. Otherwise a user could enumerate issue keys attached to pages they cannot read.
  Authorization is a *side effect of enrichment*: if the product returned the data, the user may
  see it. Write paths, which need only a yes/no answer, use a cheap single-entity probe instead.
- **Every resolver call returns an envelope** - `{ ok: true, data }` or
  `{ ok: false, code, message }` - because a thrown Error's message and custom fields are not
  guaranteed to survive Forge's `invoke` bridge, whereas plain objects always are. The UI
  branches on the stable `code` (e.g. auto-refreshing on `CONFLICT`) rather than pattern-matching
  error text. Unexpected exceptions collapse to a generic `UNKNOWN` so internals never reach the
  browser.
- **Status updates use optimistic concurrency.** The `UPDATE` is guarded by the expected
  current status; zero affected rows means someone else transitioned the link first, and the
  panel refreshes rather than silently overwriting.
- **Forge SQL has no transactions**, so `updateLinkStatus` compensates by hand: if the history
  write fails after the status update landed, the status is reverted. The invariant is that a
  status change never exists without a matching audit entry.
- **Reads are bounded.** At most 200 links are returned per page or issue; the UI shows a notice
  when the list was cut short. An unbounded read could exceed the function timeout and fail the
  whole panel rather than degrading.
- **Content type comes from Confluence, not the caller.** The link write path reads it from the
  page it just fetched, so a crafted request cannot mislabel content.
- **No hardcoded site URL.** Absolute links are built from `siteUrl` in the Forge context.

## Modules and storage

Beyond the two UI modules, `manifest.yml` declares three things that are easy to miss:

| Manifest entry                    | What it does                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| `sql: main`                       | The app-scoped MySQL database holding links and transition history. |
| `trace-db-migration-lifecycle`    | Runs migrations on `avi:forge:installed:app` and `avi:forge:upgraded:app`. |
| `trace-cleanup-deleted-content` / `trace-cleanup-deleted-issue` | Soft-unlink rows when a page, blog post or issue is deleted. |

The cleanup triggers exist because Forge SQL knows nothing about product lifecycles. Without them a
deleted page's rows would linger forever: the permission filter hides them from every panel, but
they are still read on each load. Soft-unlinking keeps the transition history intact for auditing
while taking the rows out of the hot path.

### Adding a migration

Schema changes are versioned and applied by the migration runner - never by hand.

1. Export the DDL (or DML) string from `src/migrations/schema.ts`, named for its number, e.g.
   `DDL_007_...`.
2. `.enqueue('007_short_description', DDL_007_...)` it onto the chain in
   `src/migrations/index.ts`.
3. Deploy. The lifecycle trigger fires on install and upgrade; the runner records what it has
   already applied, so `run()` only executes what is outstanding.

**Migration entries are append-only.** Never rename, reorder or delete one. Installations that
already ran a migration track it by name, so removing an entry leaves them permanently
inconsistent. `003`/`004` are the worked example: they are no-ops on a clean install because `001`
and `002` already declare `needs_rework`, but they must stay forever for installations that ran
`001`/`002` before that status existed.

Prefer idempotent statements (`CREATE TABLE IF NOT EXISTS`, `MODIFY COLUMN`) so a retried migration
is harmless.

## Workflow

The state machine lives in `src/shared/linkStatus.ts` and is imported by both the resolver and
the UI, so the backend enforces exactly the transitions the UI offers. See
[The documentation workflow](#the-documentation-workflow) above for the statuses and the
transition table.

## Resolver surface

| Endpoint                   | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `getBylineView`            | Everything the Confluence byline panel renders.        |
| `getIssuePanelView`        | Everything the Jira issue panel renders.               |
| `getLinkTransitionHistory` | Audit trail for one link.                              |
| `linkContentToTicket`      | Create or reactivate a link.                           |
| `unlinkContentFromTicket`  | Soft-unlink (history is preserved).                    |
| `updateLinkStatus`         | Guarded workflow transition.                           |
| `searchConfluenceContent`  | Content picker search (pages and blog posts).          |

## Quality gates

| Command             | Checks                                               |
| ------------------- | ---------------------------------------------------- |
| `npm run lint`      | ESLint, including strict no-`any` and the hook rules. |
| `npm run typecheck` | Strict TypeScript (`noUncheckedIndexedAccess` etc.).  |
| `npm run test`      | Vitest unit tests.                                    |
| `npm run test:coverage` | Vitest with a V8 coverage report (no thresholds). |
| `npm run verify`    | Lint, typecheck and test, in order.                   |
| `npx forge lint`    | Manifest validation.                                  |

Coverage is **informational, not enforced**: `vitest.config.ts` configures the V8 provider with
`all: true` (so untested files count too) but deliberately sets no thresholds. CI runs
`npm run test:coverage` and `scripts/coverage-summary.js` renders the totals into the GitHub
Actions job summary. To start enforcing a minimum, add a `coverage.thresholds` block to
`vitest.config.ts`.

### Conventions the tooling enforces

- **Tests sit next to the unit they cover** (`linkStatus.ts` / `linkStatus.test.ts`) rather than in
  a parallel `__tests__` tree, so a file and its test move together.
- **Presentational components may not import from `containers/`, `hooks/` or `services/`.** This is
  an ESLint `no-restricted-imports` rule scoped to
  `src/frontend/features/**/components/**`, not a convention people have to remember.
- **`any` is a lint error**, and TypeScript runs with `strict`, `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Indexed access yields `T | undefined`, so expect to narrow.
- **Only `@forge/react` components render.** Standard DOM elements (`div`, `span`, `strong`) and
  third-party React component libraries will break the panels at runtime, not at build time.

`AGENTS.md` holds the Forge-specific guidance given to AI coding assistants working in this repo.

## Deploying

### Automated deployment (GitHub Actions)

The repository includes two GitHub Actions workflows:

- **Quality** (`.github/workflows/quality.yml`): Runs on every push and pull request
  - Lints, typechecks, and runs unit tests with coverage
  - Publishes a non-blocking coverage table to the job summary
  - Blocks merge if lint, typecheck or tests fail (coverage never blocks)
  - Status checks are required

- **Deploy** (`.github/workflows/deploy.yml`): Runs on git tag push (e.g., `v7.10.0`)
  - Runs full verification (lint + typecheck + test)
  - Authenticates with Forge CLI using `FORGE_TOKEN` secret
  - Deploys to development environment
  - Posts instructions for manual upgrade

#### Setup

1. **Add `FORGE_TOKEN` secret** to your GitHub repository:
   - Go to Settings → Secrets and variables → Actions
   - Create a new secret named `FORGE_TOKEN`
   - Value: Your Forge CLI authentication token (see [Forge docs](https://developer.atlassian.com/platform/forge/getting-started/))

2. **Create a release tag** to trigger deployment:
   ```bash
   git tag v7.10.0
   git push origin v7.10.0
   ```
   The deploy workflow will start automatically.

3. **After deployment**, manually upgrade the installation:
   ```bash
   forge install --upgrade --non-interactive --site <your-site>.atlassian.net --product jira --environment development
   ```

### Manual deployment

If you need to deploy without creating a tag:

```
npm run verify
npm run deploy:dev
npm run install:dev --site=<your-site>.atlassian.net
```

Use `install:dev:upgrade` instead when the app is already installed and the manifest scopes or
permissions changed.

## Permissions

| Scope                             | Used for                                          |
| --------------------------------- | ------------------------------------------------- |
| `read:jira-work`                  | Issue summaries, issue types, icons, visibility.  |
| `read:confluence-content.summary` | Page titles, spaces and links.                    |
| `read:page:confluence`            | Page versions and the page visibility probe.      |
| `read:blogpost:confluence`        | Blog post versions and the visibility probe.      |
| `search:confluence`               | Content search and batched id lookups.            |

## Further reading

- `src/shared/linkStatus.ts` - the workflow state machine both sides import.
- `src/migrations/schema.ts` - the full database schema, one migration per export.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) - contribution terms, setup and the house rules the
  tooling enforces.
- [`PRIVACY.md`](PRIVACY.md) - what the app stores, where, and for how long.
- `AGENTS.md` - Forge-specific guidance for AI coding assistants working in this repo.

## License

Trace is source-available under the [PolyForm Perimeter License 1.0.1](LICENSE) — free to use,
modify, fork and self-host for any purpose except providing others with a competing product.
This is **not** an OSI-approved open source licence. See
[Licence and contributing](#licence-and-contributing) above, and
[CONTRIBUTING.md](CONTRIBUTING.md) for the terms that apply to pull requests.
