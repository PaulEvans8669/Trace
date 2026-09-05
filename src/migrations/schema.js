/**
 * Forge SQL DDL: 001_content_ticket_links
 * 
 * Migration: Create initial schema for content-to-ticket linking
 * 
 * This module defines the DDL operation for the first database migration.
 * Each exported constant represents a SQL statement executed during migration.
 */

/**
 * DDL: Create content_ticket_links table
 * 
 * Stores the many-to-many relationship between Confluence content
 * and Jira issues, along with the documentation update status.
 * 
 * Columns:
 * - id: Unique identifier for each link (generated ID)
 * - content_id: Confluence content ID (pages, blogs, etc.)
 * - content_type: Type of Confluence content (page, blog, article, custom)
 * - jira_issue_key: The Jira issue key this content is linked to
 * - link_status: Documentation update status
 *   - not_started: Link created but ticket work hasn't begun
 *   - ongoing_work: Ticket work in progress, docs need updates
 *   - needs_review: Docs updated, awaiting approval
 *   - done: Documentation is up to date
 * - linked_at: Timestamp (ms) when link was created
 * - updated_at: Timestamp (ms) of last status update
 * - unlinked_at: Timestamp (ms) when link was removed (null if active)
 * 
 * Constraints:
 * - Primary Key: id
 * - Unique: (content_id, jira_issue_key) — one link per content-ticket pair
 * 
 * Indexes:
 * - idx_content_id: Query by content
 * - idx_jira_issue_key: Query by ticket
 * - idx_linked_at: Ordered by creation time
 */
export const DDL_001_CONTENT_TICKET_LINKS = `
  CREATE TABLE IF NOT EXISTS content_ticket_links (
    id VARCHAR(255) PRIMARY KEY,
    content_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'page',
    jira_issue_key VARCHAR(50) NOT NULL,
    link_status ENUM('not_started', 'ongoing_work', 'needs_review', 'done') NOT NULL DEFAULT 'not_started',
    linked_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    unlinked_at BIGINT NULL,
    UNIQUE KEY unique_content_ticket (content_id, jira_issue_key),
    KEY idx_content_id (content_id),
    KEY idx_jira_issue_key (jira_issue_key),
    KEY idx_linked_at (linked_at DESC)
  )
`;

/**
 * DDL: Normalize legacy status data
 *
 * Why this migration exists:
 * Earlier deployed versions persisted the in-progress status as `needs_work`.
 * The app now standardizes on `ongoing_work`, so we first rewrite existing rows
 * before tightening the enum definition in the next migration step.
 *
 * This statement is idempotent: running it multiple times is safe because once
 * rows are converted there is nothing left to update.
 */
export const DDL_002_MIGRATE_NEEDS_WORK_TO_ONGOING_WORK = `
  UPDATE content_ticket_links
  SET link_status = 'ongoing_work'
  WHERE link_status = 'needs_work'
`;

/**
 * DDL: Enforce canonical status enum values
 *
 * After legacy rows are converted, we can safely alter the enum so the schema
 * only accepts canonical statuses moving forward.
 */
export const DDL_003_ALTER_LINK_STATUS_ENUM_ONGOING_WORK = `
  ALTER TABLE content_ticket_links
  MODIFY COLUMN link_status ENUM('not_started', 'ongoing_work', 'needs_review', 'done') NOT NULL DEFAULT 'not_started'
`;
