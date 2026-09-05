/**
 * Forge SQL Migration Runner
 * 
 * This module handles all database schema migrations for the Trace app.
 * It uses the @forge/sql migrationRunner to execute DDL operations
 * in a safe, ordered manner.
 * 
 * Migrations are idempotent (safe to run multiple times) and versioned
 * so that Forge can track which migrations have been applied.
 * 
 * Migration Naming Convention:
 * - File: NNN_descriptive_name.js (NNN = 001, 002, 003, etc.)
 * - DDL Export: DDL_NNN_DESCRIPTIVE_NAME (uppercase with underscores)
 * - Enqueue Call: 'NNN_descriptive_name' (kebab-case, matches file prefix)
 */

import { migrationRunner } from '@forge/sql';
import {
  DDL_001_CONTENT_TICKET_LINKS,
  DDL_002_MIGRATE_NEEDS_WORK_TO_ONGOING_WORK,
  DDL_003_ALTER_LINK_STATUS_ENUM_ONGOING_WORK
} from './schema.js';

/**
 * Define all migrations in order
 * 
 * Each migration has a unique sequential identifier (001, 002, 003...)
 * matching the file name and DDL export name for consistency.
 * 
 * Migrations run sequentially and are idempotent (each runs only once).
 */
const createDBObjects = migrationRunner
  .enqueue('001_content_ticket_links', DDL_001_CONTENT_TICKET_LINKS)
  .enqueue('002_migrate_needs_work_to_ongoing_work', DDL_002_MIGRATE_NEEDS_WORK_TO_ONGOING_WORK)
  .enqueue('003_alter_link_status_enum_ongoing_work', DDL_003_ALTER_LINK_STATUS_ENUM_ONGOING_WORK);

/**
 * Apply all pending migrations
 * 
 * This function is called by the scheduled trigger to run migrations
 * within an hour of app installation. It's safe to call multiple times—
 * each migration is only applied once.
 * 
 * Forge tracks applied migrations by ID and skips already-applied ones.
 * 
 * @returns {Promise<void>}
 */
export const applyMigrations = async () => {
  // Run all queued migrations
  const successfulMigrations = await createDBObjects.run();

  console.log('✓ Migrations completed successfully');
  console.log(`✓ Applied ${successfulMigrations.length} migration(s)`);

  // Log migration checkpoint with details
  const allMigrations = await migrationRunner.list();
  console.log('');
  console.log('Migration Checkpoint [after running migrations]:');
  console.log('─'.repeat(60));
  allMigrations.forEach((migration) => {
    console.log(`  ✓ ${migration.name.padEnd(40)} → ${migration.migratedAt.toUTCString()}`);
  });
  console.log('─'.repeat(60));
};

/**
 * Wrapper function for scheduled trigger
 * 
 * This is the handler that the scheduled trigger calls.
 * It invokes the applyMigrations function to run all DDL operations.
 * 
 * @returns {Promise<void>}
 */
export const runMigration = async () => {
  try {
    await applyMigrations();
  } catch (error) {
    console.error('✗ Migration failed:', error);
    throw error;
  }
};
