# Deployment Checklist for Trace App v2.0 (with SQL Migrations)

## Pre-Deployment Verification

✅ **Code Quality**
- [x] Manifest lints successfully (`forge lint`)
- [x] No TypeScript/ESLint errors
- [x] All imports are correct (@forge/sql for resolvers, @forge/resolver, @forge/bridge)
- [x] Migration files present and syntactically correct

✅ **File Structure**
- [x] `src/migrations/schema.js` — DDL definitions
- [x] `src/migrations/index.js` — Migration runner with `runMigration` export
- [x] `src/resolver/index.js` — Updated to use @forge/sql
- [x] `src/frontend/issue-context.jsx` — Jira issue context UI
- [x] `src/frontend/byline-item.jsx` — Confluence byline item UI
- [x] `manifest.yml` — Includes sql module, scheduledTrigger, functions

✅ **Dependencies**
- [x] @forge/sql installed (npm install @forge/sql)
- [x] @forge/resolver included
- [x] @forge/api included
- [x] @forge/bridge included
- [x] @forge/react included

✅ **Manifest Configuration**
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
    - key: resolver
      handler: resolver/index.handler
  jira:issueContext:
    - key: trace-issue-context
      ...
  confluence:contentBylineItem:
    - key: trace-byline-item
      ...
```

✅ **Database Schema**
- [x] `CREATE_CONTENT_TICKET_LINKS_TABLE` statement defined
- [x] Unique constraint on (content_id, jira_issue_key)
- [x] Proper indexes for performance
- [x] Soft delete support (unlinked_at column)
- [x] Status tracking (needs_work, needs_review, done)

✅ **Scopes**
- [x] read:confluence-content.summary
- [x] search:confluence
- [x] read:jira-work
- [x] write:jira-work

## Deployment Steps

### 1. Deploy the App
```bash
cd c:\Users\paule\IdeaProjects\Trace
forge deploy --non-interactive -e development
```

Expected output:
- Build successful
- Major version upgrade (due to new scopes + SQL module)
- No errors or warnings (only informational approval)

### 2. Install/Upgrade the App
```bash
forge install --non-interactive --upgrade \
  --site <your-site>.atlassian.net \
  --product jira \
  --environment development
```

### 3. Verify Installation
- Check app installation in Jira (Apps > Installed apps)
- Should show "Trace" app as installed

### 4. Wait for Migrations (up to 1 hour)
The scheduled trigger will fire within an hour:
- Schema created: `content_ticket_links` table
- Indexes created for performance
- All future resolvers can use the table

### 5. Check Logs
```bash
forge logs -e development --since 1h
```

Look for:
```
✓ Migrations completed successfully
✓ Applied 1 migration(s)
✓ v001_create_content_ticket_links_table migrated at [timestamp]
```

## Post-Deployment Testing

### Test in Jira Issue Context
1. Open any Jira issue
2. Find "Trace context" panel on the right
3. Search for a Confluence page (type ≥ 2 characters)
4. Click to link the page
5. Verify:
   - Link appears in table
   - Status shows "À faire" (needs_work)
   - Comment posted to Jira issue activity
   - Database query shows link: `SELECT * FROM content_ticket_links WHERE jira_issue_key = 'XXX-123'`

### Test Confluence Byline Item
1. Open a Confluence page linked from Jira
2. Find "Linked issues" section in page byline (under title)
3. Should show status badges for linked tickets
4. Click "Details" to expand and see full list
5. Try updating status from page (mark as done, etc.)
6. Verify:
   - Status update appears in Jira issue activity
   - Database updated: `SELECT * FROM content_ticket_links WHERE content_id = 'XXX'`

### Test Status Workflow
- Link a page to a ticket → Status = "needs_work"
- Update from context → Post Jira comment
- Verify Jira changelog shows the change

### Test Unlinking
- Click unlink button
- Verify:
  - Link removed from UI
  - `unlinked_at` timestamp set in database
  - Comment posted to Jira issue

## Rollback Plan

If issues occur:

1. **Stop using the app** — Uninstall from site
2. **Check logs** — `forge logs -e development --since 1h`
3. **Fix the issue**
4. **Redeploy** — `forge deploy --non-interactive -e development`
5. **Reinstall** — `forge install --non-interactive --upgrade ...`

Note: Since migrations are idempotent, redeploying is safe.

## Success Criteria

✅ App installs without errors
✅ Schema created within 1 hour
✅ Can link Confluence content to Jira issues
✅ Status updates post to Jira activity
✅ Byline item shows linked tickets
✅ Unlink removes relationship
✅ No database errors in logs

## Next Steps (After Successful Deployment)

1. Monitor app logs for 24 hours
2. Test with different Confluence content types (pages, blogs)
3. Test with multiple Jira projects
4. Gather user feedback
5. Plan v2.1 improvements (if any)

## Support & Documentation

- Forge Docs: https://developer.atlassian.com/platform/forge/
- SQL Tutorial: https://developer.atlassian.com/platform/forge/storage-reference/sql-tutorial/
- Migration Reference: See MIGRATION_QUICK_REFERENCE.md
- Implementation Details: See MIGRATION_IMPLEMENTATION.md
