# Forge SQL Migrations - Quick Reference

## Technical Naming Convention

All migrations follow a consistent naming pattern across files, exports, and enqueue calls:

```
File:        schema.js (contains all DDL exports)
Export:      DDL_001_CONTENT_TICKET_LINKS  (DDL_NNN_DESCRIPTIVE_NAME)
Enqueue:     '001_content_ticket_links'    (NNN_descriptive_name)
```

**Pattern Breakdown:**
- **NNN** = Sequential number (001, 002, 003, etc.)
- **descriptive_name** = What the migration does (lowercase with underscores)
- **File**: Contains all DDL exports in one `schema.js`
- **Export**: `DDL_NNN_DESCRIPTIVE_NAME` (UPPERCASE)
- **Enqueue**: `'NNN_descriptive_name'` (lowercase, matches file prefix)

### Current Migrations

| ID | File | Export | Enqueue | Purpose |
|---|---|---|---|---|
| 001 | schema.js | `DDL_001_CONTENT_TICKET_LINKS` | `'001_content_ticket_links'` | Create content-to-ticket link table |

## Structure
```
src/
  migrations/
    schema.js       → All DDL_NNN_* exports
    index.js        → Migration runner (imports & enqueues)
```

## How to Add a Migration

### Step 1: Add DDL in `src/migrations/schema.js`
```javascript
/**
 * DDL: Describe what this migration does
 * ... documentation ...
 */
export const DDL_002_LINK_STATUS_HISTORY = `
  CREATE TABLE IF NOT EXISTS content_ticket_link_history (
    id VARCHAR(255) PRIMARY KEY,
    link_id VARCHAR(255) NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_at BIGINT NOT NULL,
    FOREIGN KEY (link_id) REFERENCES content_ticket_links(id)
  )
`;
```

### Step 2: Queue in `src/migrations/index.js`
```javascript
import { DDL_001_CONTENT_TICKET_LINKS, DDL_002_LINK_STATUS_HISTORY } from './schema.js';

const createDBObjects = migrationRunner
  .enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)
  .enqueue('002_link_status_history', DDL_002_LINK_STATUS_HISTORY);  // ← Add here
```

### Step 3: Deploy
```bash
forge deploy --non-interactive -e development
forge install --non-interactive --upgrade --site <site-url> --product jira --environment development
```

## Key Points

- **Versioning**: Sequential numbering (001, 002, 003...) ensures order
- **Idempotent**: All DDL uses `IF NOT EXISTS` or `IF` conditions
- **Consistency**: Same number used in file export and enqueue call
- **Documentation**: Each DDL has clear comment header
- **One File**: All DDL in `schema.js` for easy discovery
- **Ordered Execution**: Migrations run sequentially by number
- **Single Location**: Import statements in `index.js` show all active migrations

## Common Patterns

### Create Table
```javascript
export const DDL_NNN_TABLE_NAME = `
  CREATE TABLE IF NOT EXISTS table_name (
    id VARCHAR(255) PRIMARY KEY,
    KEY idx_field (field_name)
  )
`;
```

### Add Column
```javascript
export const DDL_NNN_ADD_COLUMN = `
  ALTER TABLE table_name ADD COLUMN IF NOT EXISTS field_name TYPE
`;
```

### Add Index
```javascript
export const DDL_NNN_ADD_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_name ON table_name(field_name)
`;
```

## Troubleshooting

**Migration not running?**
- Check logs: `forge logs -e development --since 1h`
- Look for: `✓ 001_content_ticket_links`
- Wait up to 1 hour after installation

**Schema error in resolver?**
- Verify migration ran successfully
- Check enqueue call matches export name
- Ensure DDL syntax is correct

**Need to debug migrations?**
- Log output shows each migration with timestamp
- Use `migrationRunner.list()` to see applied migrations
- Check database directly for table existence
