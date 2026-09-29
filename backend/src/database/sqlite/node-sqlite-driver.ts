/**
 * better-sqlite3 compatible shim backed by Node's built-in `node:sqlite` module.
 *
 * TypeORM's `better-sqlite3` driver can be handed an alternative driver package
 * through the `driver` option of `BetterSqlite3ConnectionOptions`. We use that
 * hook so the whole project can run with zero native compilation (no Python /
 * node-gyp required) while still executing real SQL against a real file.
 *
 * Only the surface TypeORM actually touches is implemented:
 *   Database: prepare, pragma, exec, close, open, name, memory, loadExtension
 *   Statement: reader, all, get, run, iterate, columns
 */

export interface SqliteStatementOptions {
  reader?: boolean;
  statement?: unknown;
}

/** Statements that only read data report `reader === true` in better-sqlite3. */
const READER_PREFIX = /^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*(SELECT|PRAGMA|EXPLAIN|VALUES|WITH)\b/i;

function isReaderQuery(sql: string): boolean {
  const match = READER_PREFIX.exec(sql);
  if (!match) return false;
  const keyword = match[1].toUpperCase();
  if (keyword !== 'WITH') return true;
  // `WITH ... INSERT/UPDATE/DELETE` is a writer.
  return !/\b(INSERT|UPDATE|DELETE|REPLACE)\b[\s\S]*$/i.test(sql);
}

/** node:sqlite only accepts null | number | bigint | string | Uint8Array. */
function normalizeParameter(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
    case 'bigint':
      return value as string;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value ? 1 : 0;
    case 'object':
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Uint8Array) return value;
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

/** Rows come back with a null prototype, give callers ordinary objects. */
function toPlainRow<T>(row: unknown): T {
  return Object.assign({}, row) as T;
}

export class SqliteStatement {
  readonly reader: boolean;
  private readonly raw: any;

  constructor(raw: any, sql: string) {
    this.raw = raw;
    this.reader = isReaderQuery(sql);
  }

  all(...params: unknown[]): unknown[] {
    return this.raw
      .all(...params.map(normalizeParameter))
      .map((row: unknown) => toPlainRow(row));
  }

  get(...params: unknown[]): unknown {
    const row = this.raw.get(...params.map(normalizeParameter));
    return row === undefined ? undefined : toPlainRow(row);
  }

  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const result = this.raw.run(...params.map(normalizeParameter));
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowid: Number(result.lastInsertRowid ?? 0),
    };
  }

  iterate(...params: unknown[]): IterableIterator<unknown> {
    const rows = this.all(...params);
    return rows[Symbol.iterator]() as IterableIterator<unknown>;
  }

  columns(): Array<{ name: string; column: string | null; type: string }> {
    return this.raw.columns();
  }

  raw_(): IterableIterator<unknown> {
    throw new Error('node-sqlite shim: raw() rows are not supported');
  }

  finalize(): void {
    /* statements are garbage collected by node:sqlite */
  }
}

export class SqliteDatabase {
  private readonly handle: any;

  readonly open: boolean = true;
  readonly name: string;
  readonly memory: boolean;

  constructor(filename: string, _options: Record<string, unknown> = {}) {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    this.handle = new DatabaseSync(filename);
    this.name = filename;
    this.memory = filename === ':memory:';
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.handle.prepare(sql), sql);
  }

  exec(sql: string): this {
    this.handle.exec(sql);
    return this;
  }

  /**
   * better-sqlite3 accepts `PRAGMA foo = bar` (setter, returns []) as well as
   * `PRAGMA table_info("x")` (reader, returns rows). Mirror that behaviour.
   */
  pragma(source: string): unknown[] {
    const statement = this.prepare(`PRAGMA ${source}`);
    if (statement.reader) {
      try {
        return statement.all();
      } catch {
        return [];
      }
    }
    statement.run();
    return [];
  }

  loadExtension(): this {
    throw new Error('node-sqlite shim: loadExtension is not supported');
  }

  close(callback?: (error: Error | null) => void): void {
    try {
      this.handle.close();
    } catch (error) {
      if (callback) {
        callback(error as Error);
        return;
      }
      throw error;
    }
    if (callback) callback(null);
  }
}

/** Exported in the shape TypeORM expects from the `better-sqlite3` package. */
export const Database = SqliteDatabase;
export default { Database: SqliteDatabase };
