import { errorCodes, sql } from '@forge/sql';

/**
 * Small wrapper around `@forge/sql` that adds structured error logging and a couple of helpers
 * for reading results. Everything else in the backend goes through `executeSql` so that error
 * handling lives in exactly one place.
 */

export interface SqlRow {
  [key: string]: string | number | null | undefined;
}

/**
 * Modifying statements (INSERT/UPDATE/DELETE) return a result *header* rather than a list of
 * rows, so `rows` can be either shape depending on the query.
 */
interface SqlResultHeader {
  affectedRows?: number;
  changedRows?: number;
  insertId?: number | string;
}

export interface SqlResult {
  rows?: SqlRow[] | SqlResultHeader;
}

export type SqlPrimitive = string | number | null;
export type SqlParams = SqlPrimitive[];

interface ForgeSqlErrorLike {
  code?: string;
  message?: string;
  suggestion?: string;
  debug?: {
    code?: string;
    errno?: number;
    sqlMessage?: string;
    sqlState?: string;
    message?: string;
  };
  context?: {
    debug?: {
      code?: string;
      errno?: number;
      sqlMessage?: string;
      sqlState?: string;
      message?: string;
      sql?: string;
    };
    queryType?: string;
  };
}

/**
 * Logs enough to debug a failing query without leaking data.
 *
 * Bound parameters are content ids, issue keys and account ids - user-identifying values that
 * should not end up in app logs - so we record only how many there were.
 */
const logSqlError = (query: string, params: SqlParams, error: unknown): void => {
  const sqlError = error as ForgeSqlErrorLike;
  const debug = sqlError.debug || sqlError.context?.debug;

  const sharedDetails = {
    code: sqlError.code || 'UNKNOWN',
    message: sqlError.message || 'Unknown SQL error',
    suggestion: sqlError.suggestion || null,
    queryType: sqlError.context?.queryType || null,
    query,
    paramCount: params.length
  };

  if (sqlError.code === errorCodes.QUERY_TIMED_OUT) {
    console.error('Forge SQL query timed out', sharedDetails);
    return;
  }

  if (sqlError.code === 'SQL_POLICY_VIOLATION') {
    console.error('Forge SQL policy violation', sharedDetails);
    return;
  }

  if (sqlError.code === errorCodes.INVALID_SQL_QUERY) {
    console.error('Forge SQL invalid query', {
      ...sharedDetails,
      debugCode: debug?.code || null,
      debugSqlState: debug?.sqlState || null,
      debugSqlMessage: debug?.sqlMessage || debug?.message || null
    });
    return;
  }

  if (sqlError.code === errorCodes.SQL_EXECUTION_ERROR) {
    const debugCode = debug?.code || null;
    const debugSqlMessage = debug?.sqlMessage || debug?.message || null;
    if (debugCode === 'ER_NO_SUCH_TABLE') {
      console.error('Forge SQL execution error: schema is not initialized yet', {
        ...sharedDetails,
        debugCode,
        debugErrno: debug?.errno || null,
        debugSqlState: debug?.sqlState || null,
        debugSqlMessage,
        action: 'Run the migration function before invoking DML resolvers'
      });
      return;
    }

    console.error('Forge SQL execution error', {
      ...sharedDetails,
      debugCode,
      debugErrno: debug?.errno || null,
      debugSqlState: debug?.sqlState || null,
      debugSqlMessage
    });
    return;
  }

  console.error('Unexpected SQL error', {
    ...sharedDetails,
    debugCode: debug?.code || null,
    debugSqlState: debug?.sqlState || null,
    debugSqlMessage: debug?.sqlMessage || debug?.message || null
  });
};

export const executeSql = async (query: string, params: SqlParams = []): Promise<SqlResult> => {
  const statement = sql.prepare(query);
  const boundStatement = params.length > 0 ? statement.bindParams(...params) : statement;
  try {
    return (await boundStatement.execute()) as SqlResult;
  } catch (error) {
    logSqlError(query, params, error);
    throw error;
  }
};

/** Reads the row list from a SELECT result, returning an empty array for any other shape. */
export const selectRows = (result: SqlResult): SqlRow[] => {
  return Array.isArray(result.rows) ? result.rows : [];
};

/** Reads the first row of a SELECT result, or `null` when there is none. */
export const selectFirstRow = (result: SqlResult): SqlRow | null => {
  return selectRows(result)[0] || null;
};

/**
 * Reads how many rows a modifying statement actually touched.
 *
 * Used to detect conflicts: a guarded `UPDATE ... WHERE link_status = ?` that affects zero rows
 * means somebody else changed the row first.
 */
export const affectedRowCount = (result: SqlResult): number => {
  if (!result.rows || Array.isArray(result.rows)) {
    return 0;
  }

  const affected = result.rows.affectedRows;
  return typeof affected === 'number' && Number.isFinite(affected) ? affected : 0;
};

export const rowValue = <T extends string | number | null | undefined>(row: SqlRow, key: string): T => {
  return row[key] as T;
};
