/**
 * Forge SQL DDL: 001_content_ticket_links
 *
 * Clean-install schema for content-to-ticket linking with transition/version tracking.
 */
export const DDL_001_CONTENT_TICKET_LINKS = `
  CREATE TABLE IF NOT EXISTS content_ticket_links (
    id VARCHAR(255) PRIMARY KEY,
    content_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'page',
    jira_issue_key VARCHAR(50) NOT NULL,
    link_status ENUM('not_started', 'ongoing_work', 'needs_review', 'needs_rework', 'done') NOT NULL DEFAULT 'not_started',
    linked_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    last_transition_version INT NULL,
    last_transition_at BIGINT NULL,
    unlinked_at BIGINT NULL,
    UNIQUE KEY unique_content_ticket (content_id, jira_issue_key),
    KEY idx_content_id (content_id),
    KEY idx_jira_issue_key (jira_issue_key),
    KEY idx_linked_at (linked_at DESC)
  )
`;

/**
 * Forge SQL DDL: 002_content_ticket_link_transitions
 *
 * Append-only history of link transitions so the UI can render a native history view.
 */
export const DDL_002_CONTENT_TICKET_LINK_TRANSITIONS = `
  CREATE TABLE IF NOT EXISTS content_ticket_link_transitions (
    id VARCHAR(255) PRIMARY KEY,
    link_id VARCHAR(255) NOT NULL,
    content_id VARCHAR(255) NOT NULL,
    jira_issue_key VARCHAR(50) NOT NULL,
    link_status ENUM('not_started', 'ongoing_work', 'needs_review', 'needs_rework', 'done') NOT NULL,
    transition_version INT NOT NULL,
    transitioned_at BIGINT NOT NULL,
    transitioned_by_account_id VARCHAR(255) NOT NULL,
    KEY idx_link_id (link_id),
    KEY idx_content_id (content_id),
    KEY idx_jira_issue_key (jira_issue_key),
    KEY idx_transitioned_at (transitioned_at DESC)
  )
`;

/**
 * Forge SQL DDL: 003_add_needs_rework_status / 004_add_needs_rework_status_transitions
 *
 * No-ops on a clean install (001 and 002 already declare `needs_rework`), but they must be kept
 * forever: installations that ran 001/002 *before* `needs_rework` existed still need these
 * ALTERs, and removing an already-applied migration from the runner would break them.
 */
export const DDL_003_ADD_NEEDS_REWORK_STATUS = `
  ALTER TABLE content_ticket_links
  MODIFY COLUMN link_status ENUM('not_started', 'ongoing_work', 'needs_review', 'needs_rework', 'done') NOT NULL DEFAULT 'not_started'
`;

export const DDL_004_ADD_NEEDS_REWORK_STATUS_TRANSITIONS = `
  ALTER TABLE content_ticket_link_transitions
  MODIFY COLUMN link_status ENUM('not_started', 'ongoing_work', 'needs_review', 'needs_rework', 'done') NOT NULL
`;

/**
 * Forge SQL DDL: 005_nullable_transition_account_id
 *
 * The column used to be NOT NULL, which forced the app to write the literal string
 * 'placeholder-user' whenever the resolver context had no accountId. Making it nullable lets us
 * record "unknown user" honestly, and the UPDATE clears the old sentinel rows.
 */
export const DDL_005_NULLABLE_TRANSITION_ACCOUNT_ID = `
  ALTER TABLE content_ticket_link_transitions
  MODIFY COLUMN transitioned_by_account_id VARCHAR(255) NULL
`;

export const DML_006_CLEAR_PLACEHOLDER_ACCOUNT_IDS = `
  UPDATE content_ticket_link_transitions
  SET transitioned_by_account_id = NULL
  WHERE transitioned_by_account_id = 'placeholder-user'
`;
