import { migrationRunner } from '@forge/sql';
import {
  DDL_001_CONTENT_TICKET_LINKS,
  DDL_002_CONTENT_TICKET_LINK_TRANSITIONS,
  DDL_003_ADD_NEEDS_REWORK_STATUS,
  DDL_004_ADD_NEEDS_REWORK_STATUS_TRANSITIONS,
  DDL_005_NULLABLE_TRANSITION_ACCOUNT_ID,
  DML_006_CLEAR_PLACEHOLDER_ACCOUNT_IDS
} from './schema';

/**
 * Schema migrations.
 *
 * The runner records which migrations have already been applied, so `run()` is safe to call
 * repeatedly and only executes what is outstanding. Migration names are append-only: never
 * rename or remove an entry, or installations that already ran it will be inconsistent.
 *
 * This runs from the app lifecycle trigger (install/upgrade) - see manifest.yml.
 */
const createDBObjects = migrationRunner
  .enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)
  .enqueue('002_content_ticket_link_transitions', DDL_002_CONTENT_TICKET_LINK_TRANSITIONS)
  .enqueue('003_add_needs_rework_status', DDL_003_ADD_NEEDS_REWORK_STATUS)
  .enqueue('004_add_needs_rework_status_transitions', DDL_004_ADD_NEEDS_REWORK_STATUS_TRANSITIONS)
  .enqueue('005_nullable_transition_account_id', DDL_005_NULLABLE_TRANSITION_ACCOUNT_ID)
  .enqueue('006_clear_placeholder_account_ids', DML_006_CLEAR_PLACEHOLDER_ACCOUNT_IDS);

export const applyMigrations = async (): Promise<void> => {
  const successfulMigrations = await createDBObjects.run();
  console.log(`Trace migrations complete: applied ${successfulMigrations.length} migration(s)`);
};

/** Entry point referenced by the `runMigration` function in manifest.yml. */
export const runMigration = async (): Promise<void> => {
  await applyMigrations();
};
