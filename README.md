# Trace

**Keep Jira delivery and Confluence documentation in step.**

Trace links Jira issues to the Confluence pages they affect, and tracks whether the
documentation actually got written.

- [The problem](#the-problem)
- [What Trace does](#what-trace-does)
- [The two surfaces](#the-two-surfaces)
- [The documentation workflow](#the-documentation-workflow)
- [A typical flow](#a-typical-flow)
- [Requirements](#requirements)
- [Privacy and data](#privacy-and-data)
- [Licence and contributing](#licence-and-contributing)
- [Getting started](#getting-started) *(developers)*
- [Architecture](#architecture)
- [Modules and storage](#modules-and-storage)
- [Resolver surface](#resolver-surface)
- [Quality gates](#quality-gates)
- [Deploying](#deploying)
- [Permissions](#permissions)

## The problem

Documentation drifts out of date, and nobody notices until someone is misled by it.

The reason is rarely laziness. It is that nothing connects the work to the docs. An issue gets
delivered, the page that describes that behaviour is now subtly wrong, and there is no record
anywhere that says "this page needed updating because of this issue". Jira's own Confluence
links are a flat list of URLs: they tell you a page is *related*, not whether anyone has done
anything about it.

Trace adds the missing piece — a **status** on the relationship itself, and a record of who
moved it.

## What Trace does

Trace lets anyone working on an issue say "this issue affects that page", then track the
documentation work as a small workflow, from both Jira and Confluence.

| Feature | What it gives you |
| --- | --- |
| **Two-way linking** | Link an issue to a Confluence page or blog post from the issue, and see the issues attached to a page from the page. |
| **A documentation status per link** | Each link carries its own status, so one issue can have a documented page and an outstanding one. |
| **Search-based content picker** | Find pages and blog posts by title from inside the issue — no copying URLs. |
| **Audit trail** | Every status change records who made it and when, and the trail survives unlinking. |
| **Page-version awareness** | Trace records the page version at each status change, so a page edited after being marked `done` is visible as such. |
| **Permission-aware by construction** | Everything is read as *you*, so Trace never reveals an issue or page you could not already open. |
| **Automatic cleanup** | Delete a page or an issue and its links quietly retire, while the history is preserved for auditing. |

## The two surfaces

### Jira: the issue context panel

<!-- screenshot: Jira issue context panel showing linked Confluence pages -->

Opens in the context panel of any Jira issue, under the heading **Trace**.

From here you can search Confluence for a page or blog post and link it to the issue, see
everything already linked with its current documentation status, and unlink anything that turned
out to be irrelevant. It answers the question a developer asks while closing an issue: *what do
I need to go and document?*

### Confluence: the byline item

<!-- screenshot: Confluence byline item showing linked Jira issues and their statuses -->

Appears in the byline of any page or blog post, next to the author and last-modified date.

It lists the Jira issues linked to that page and each link's documentation status, lets you move
a status along the workflow, and lets you drill into the full transition history for any link.
It answers the question a technical writer or reviewer asks while reading a page: *is this page
still accurate, and who last confirmed it?*

## The documentation workflow

Each link moves through five statuses. Transitions are enforced by the app, not merely suggested
by the interface, so the history stays meaningful.

| Status | Meaning |
| --- | --- |
| `not_started` | The link exists; nobody has picked up the documentation yet. Every new link starts here. |
| `ongoing_work` | Someone is actively writing or updating the page for this issue. |
| `needs_review` | The writing is done and is waiting for someone else to check it. |
| `needs_rework` | A reviewer looked and sent it back with changes needed. |
| `done` | The documentation is complete and accepted. Terminal — the link is closed. |

Permitted transitions:

| From | Can move to |
| -------------- | -------------------------- |
| `not_started`  | `ongoing_work`             |
| `ongoing_work` | `needs_review`, `done`     |
| `needs_review` | `needs_rework`, `done`     |
| `needs_rework` | `done`, `ongoing_work`     |
| `done`         | (terminal)                 |

## A typical flow

1. A developer picks up `TRACE-42` and realises it changes behaviour described on the *Billing
   rules* page. From the issue's Trace panel, they search for the page and link it. The link
   starts at `not_started`.
2. The issue ships. A technical writer opens *Billing rules*, sees `TRACE-42` sitting in the
   byline at `not_started`, and moves it to `ongoing_work` before editing.
3. With the page rewritten, they move the link to `needs_review`.
4. A reviewer reads the page. Something is missing, so they move it to `needs_rework` — which is
   recorded against their name and the page version they read.
5. The writer fixes it and the reviewer moves the link to `done`. The page now shows a closed
   link, and the history records every step and everyone involved.

If someone edits the page afterwards, the recorded version no longer matches the current one —
a signal that the "done" may be worth revisiting.

## Requirements

- An **Atlassian Cloud** site. Trace is a Forge app and runs only on Cloud.
- **Jira is required.** The Jira issue context panel is the primary surface.
- **Confluence is optional but strongly recommended.** Without it, there is nothing to link to
  and the byline item never appears.
- Install the app into **both products** to get both surfaces — installing into Jira alone does
  not add the Confluence byline item.

## Privacy and data

Trace stores only the links themselves: the Confluence content ID, the Jira issue key, the
status, timestamps, and the Atlassian account ID of whoever made each status change. It stores
no page content, no issue content, and no names or email addresses — those are fetched live from
Jira and Confluence at render time and discarded.

All of it lives in a Forge SQL database **hosted and operated by Atlassian**. There are no
external servers, no analytics and no telemetry. See [PRIVACY.md](PRIVACY.md) for the full
policy.

## Licence and contributing

Trace is **source-available**, not open source, under the
[PolyForm Perimeter License 1.0.1](LICENSE). You may use, modify, fork and self-host it for any
purpose — including commercially inside your own organisation — but not to provide others with a
product that competes with Trace.

Contributions are welcome. Note that pull requests carry an explicit grant of rights to the
maintainer; see [CONTRIBUTING.md](CONTRIBUTING.md) before opening one.

---

# Developer documentation

Everything below is for people working on Trace itself. It ships two UI modules — a Jira issue
context panel and a Confluence byline item — over links and transition history stored in Forge
SQL, so the data belongs to the app rather than to any one issue or page.

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
