# Forge SQL Migration Implementation for Trace App

## Overview
The Trace app now uses proper Forge SQL migrations following Atlassian best practices, replacing inline schema creation with a structured, versioned migration system.

## What Changed

### 1. **Package Installation**
- ✅ Added `@forge/sql` package for proper SQL SDK support

### 2. **Manifest Updates**
```yaml
modules:
  sql:
    - key: main
      engine: mysql
  scheduledTrigger:
    - key: trace-db-migration
      function: runMigration
      interval: hour
  function:
    - key: runMigration
      handler: migrations/index.runMigration
```

### 3. **Migration Files Created**

#### `src/migrations/schema.js`
- Defines all DDL (Data Definition Language) statements
- Exports named constants using technical convention: `DDL_NNN_DESCRIPTIVE_NAME`
- Contains `DDL_001_CONTENT_TICKET_LINKS` export
- Fully commented with schema documentation and constraints
- Idempotent statements (safe to run multiple times)

#### `src/migrations/index.js`
- Implements `migrationRunner` from `@forge/sql`
- Versions each migration using sequential numbering (001, 002, 003...)
- Enqueue calls match DDL export naming: `.enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)`
- Exports `runMigration` function for scheduled trigger
- Exports `applyMigrations` function for migration execution
- Includes formatted logging with checkpoint details

### 4. **Resolver Updates**
- Changed import from `@forge/api` to `@forge/sql` for SQL operations
- Removed `ensureSchema()` function (now handled by migrations)
- Removed schema initialization calls from all resolver functions
- Resolver now assumes schema exists (created by migrations)

## How It Works

1. **App Installation**
   - Forge CLI creates the SQL module
   - Manifest defines scheduled trigger for migrations

2. **Within 1 Hour of Installation**
   - Scheduled trigger fires `runMigration` function
   - `migrationRunner.enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)` queues the migration
   - All queued migrations execute in order (001, 002, 003, etc.)
   - Forge tracks which migrations have been applied (idempotent)

3. **Schema Persistence**
   - Migration status stored in Forge SQL internals
   - Each migration only runs once
   - Safe to run multiple times (no duplicate table errors)
   - Log output shows each migration with timestamp

4. **Resolver Operations**
   - All CRUD operations use `@forge/sql` directly
   - Schema guaranteed to exist by migration system
   - No runtime schema validation needed

## Database Schema

**Table: `content_ticket_links`**
- Primary Key: `id` (VARCHAR 255)
- Foreign/Relation Columns: `content_id`, `jira_issue_key`
- Status Tracking: `link_status`, `linked_at`, `updated_at`, `unlinked_at`
- Indexes: Multiple for performance optimization
- Unique Constraint: One link per (content_id, jira_issue_key) pair

## Migration Versioning & Naming Convention

All migrations follow a consistent three-part naming pattern for discoverability and maintenance:

### Naming Pattern: `NNN_descriptive_name`

**Sequential Number (NNN):**
- 001, 002, 003... (zero-padded)
- Determines execution order
- Unique identifier for each migration

**Descriptive Name:**
- lowercase with underscores
- Describes what the migration does
- Examples: `content_ticket_links`, `add_audit_log`, `create_indexes`

### Consistency Across Three Locations

| Location | Format | Example |
|----------|--------|---------|
| File | `schema.js` | (all DDL in one file) |
| Export | `DDL_NNN_DESCRIPTIVE_NAME` | `DDL_001_CONTENT_TICKET_LINKS` |
| Enqueue | `'NNN_descriptive_name'` | `'001_content_ticket_links'` |

### Current Migrations

```
001_content_ticket_links
  ├─ File: schema.js
  ├─ Export: DDL_001_CONTENT_TICKET_LINKS
  └─ Enqueue: .enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)
```

### Adding Migration 002

1. **Add DDL export** in `schema.js`:
   ```javascript
   export const DDL_002_ADD_AUDIT_LOG = `CREATE TABLE ...`;
   ```

2. **Import in** `index.js`:
   ```javascript
   import { DDL_001_CONTENT_TICKET_LINKS, DDL_002_ADD_AUDIT_LOG } from './schema.js';
   ```

3. **Enqueue** in `index.js`:
   ```javascript
   const createDBObjects = migrationRunner
     .enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)
     .enqueue('002_add_audit_log', DDL_002_ADD_AUDIT_LOG);
   ```

The naming consistency makes it trivial to:
- Find which DDL implements a migration
- See all active migrations in one place (imports + enqueue calls)
- Add new migrations (copy pattern, increment number)
- Debug (names match across file, export, and enqueue)

## Benefits of This Approach

✅ **Version Control** — Each migration is tracked and versioned
✅ **Idempotent** — Safe to run multiple times
✅ **Declarative** — Schema defined clearly in DDL statements
✅ **Ordered Execution** — Migrations run sequentially with dependencies
✅ **Audit Trail** — Logging shows which migrations were applied when
✅ **Production Ready** — Follows Atlassian best practices
✅ **No Runtime Checks** — No schema validation on every resolver call

## Deployment Notes

When deploying this update:
- Major version bump expected (due to new scopes + SQL module)
- First deployment will trigger migration within 1 hour
- All subsequent deployments will skip already-applied migrations
- Safe to redeploy without data loss (migrations are idempotent)

## Files Changed

- `manifest.yml` — Added sql module and scheduledTrigger
- `src/resolver/index.js` — Updated imports, removed ensureSchema
- `src/migrations/schema.js` — NEW: DDL definitions
- `src/migrations/index.js` — NEW: Migration runner
- `package.json` — Added @forge/sql dependency
