# Migration Naming Convention - Technical Implementation

## Overview

The Trace app uses a consistent, three-part naming convention for all database migrations. This ensures clarity, discoverability, and maintainability across files, exports, and enqueue calls.

## Naming Pattern

```
NNN_descriptive_name
├─ NNN = Sequential number (001, 002, 003, ...)
└─ descriptive_name = lowercase with underscores
```

## Three-Location Consistency

| Location | Format | Example |
|----------|--------|---------|
| **File** | Single file: `schema.js` | Contains all DDL exports |
| **Export** | `DDL_NNN_DESCRIPTIVE_NAME` | `DDL_001_CONTENT_TICKET_LINKS` |
| **Enqueue Call** | `'NNN_descriptive_name'` | `.enqueue('001_content_ticket_links', ...)` |

## Why This Pattern?

✅ **Ordered Execution** — Sequential numbers (001, 002, 003) ensure migrations run in order
✅ **Discoverability** — File + export + enqueue use same number for easy matching
✅ **Maintainability** — Adding migration 002 follows same pattern as 001
✅ **Documentation** — Descriptive name explains what each migration does
✅ **Import Clarity** — All imports in `index.js` show all active migrations at a glance

## Current Implementation

### Migration 001: Content-to-Ticket Linking

**File:** `src/migrations/schema.js`
```javascript
/**
 * Forge SQL DDL: 001_content_ticket_links
 * 
 * Migration: Create initial schema for content-to-ticket linking
 */
export const DDL_001_CONTENT_TICKET_LINKS = `
  CREATE TABLE IF NOT EXISTS content_ticket_links (
    id VARCHAR(255) PRIMARY KEY,
    content_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'page',
    jira_issue_key VARCHAR(50) NOT NULL,
    link_status VARCHAR(50) NOT NULL DEFAULT 'needs_work',
    linked_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    unlinked_at BIGINT NULL,
    UNIQUE KEY unique_content_ticket (content_id, jira_issue_key),
    KEY idx_content_id (content_id),
    KEY idx_jira_issue_key (jira_issue_key),
    KEY idx_linked_at (linked_at DESC)
  )
`;
```

**File:** `src/migrations/index.js`
```javascript
import { migrationRunner } from '@forge/sql';
import { DDL_001_CONTENT_TICKET_LINKS } from './schema.js';

const createDBObjects = migrationRunner
  .enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS);

export const applyMigrations = async () => {
  const successfulMigrations = await createDBObjects.run();
  
  console.log('✓ Migrations completed successfully');
  console.log(`✓ Applied ${successfulMigrations.length} migration(s)`);

  const allMigrations = await migrationRunner.list();
  console.log('');
  console.log('Migration Checkpoint [after running migrations]:');
  console.log('─'.repeat(60));
  allMigrations.forEach((migration) => {
    console.log(`  ✓ ${migration.name.padEnd(40)} → ${migration.migratedAt.toUTCString()}`);
  });
  console.log('─'.repeat(60));
};
```

## Adding a New Migration

### Example: Migration 002 - Link Status History

#### Step 1: Add DDL in `schema.js`
```javascript
/**
 * DDL: Create audit trail for link status changes
 */
export const DDL_002_LINK_STATUS_HISTORY = `
  CREATE TABLE IF NOT EXISTS content_ticket_link_history (
    id VARCHAR(255) PRIMARY KEY,
    link_id VARCHAR(255) NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_at BIGINT NOT NULL,
    changed_by VARCHAR(255),
    FOREIGN KEY (link_id) REFERENCES content_ticket_links(id)
  )
`;
```

#### Step 2: Update imports in `index.js`
```javascript
import { DDL_001_CONTENT_TICKET_LINKS, DDL_002_LINK_STATUS_HISTORY } from './schema.js';
```

#### Step 3: Add enqueue call in `index.js`
```javascript
const createDBObjects = migrationRunner
  .enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)
  .enqueue('002_link_status_history', DDL_002_LINK_STATUS_HISTORY);
```

#### Step 4: Deploy
```bash
forge deploy --non-interactive -e development
forge install --non-interactive --upgrade --site <url> --product jira --environment development
```

## Benefits of This Approach

### For Developers
- **Import Statement = Complete Overview** — All active migrations visible in one place
- **Easy to Add** — Copy existing pattern, increment number
- **Easy to Debug** — Same number in file export and enqueue call
- **Self-Documenting** — Descriptive name explains migration purpose

### For Operations
- **Deterministic Ordering** — Sequential numbers prevent conflicts
- **Idempotent Execution** — Each migration runs exactly once
- **Audit Trail** — Log shows which migrations applied and when
- **Version Control** — Git history matches migration names

### For Maintenance
- **Consistency** — Pattern applies to all migrations forever
- **Scalability** — Works for 10 migrations or 100 migrations
- **Discoverability** — Same number across file + export + enqueue
- **No Ambiguity** — Can't confuse which export goes with which enqueue

## Common Naming Examples

```
001_content_ticket_links          ← Create main table
002_link_status_history           ← Add audit table
003_add_change_reason             ← Add column
004_create_content_index          ← Create index
005_migrate_legacy_links          ← Data migration
006_add_foreign_keys              ← Add constraints
007_optimize_queries              ← Create indexes
```

## Migration Log Output

When migrations run, output shows the naming convention:

```
✓ Migrations completed successfully
✓ Applied 1 migration(s)

Migration Checkpoint [after running migrations]:
────────────────────────────────────────────────────────────
  ✓ 001_content_ticket_links      → Mon, 30 Aug 2026 20:15:57 GMT
────────────────────────────────────────────────────────────
```

## Files Modified

- ✅ `src/migrations/schema.js` — DDL exports use `DDL_NNN_NAME` pattern
- ✅ `src/migrations/index.js` — Enqueue calls use `'NNN_name'` pattern
- ✅ `MIGRATION_QUICK_REFERENCE.md` — Documentation for new developers
- ✅ `MIGRATION_IMPLEMENTATION.md` — Technical implementation details
