import { DatabaseSync, constants } from 'node:sqlite';
import { compile } from '../src/schema.mjs';

const maxRows = 100;
const maxColumns = 100;
const unsafeFunctions = new Set(['load_extension', 'readfile', 'writefile']);
const readActions = new Set([constants.SQLITE_SELECT, constants.SQLITE_READ, constants.SQLITE_RECURSIVE]);

function formatValue(value) {
  if (value === null) return null;
  if (value instanceof Uint8Array) {
    return '0x' + Buffer.from(value.subarray(0, 500)).toString('hex') + (value.length > 500 ? '…' : '');
  }
  const text = String(value);
  return text.length > 1000 ? text.slice(0, 1000) + '…' : text;
}

function runQuery({ draft, query }) {
  const db = new DatabaseSync(':memory:', { allowExtension: false });
  try {
    if (typeof db.setAuthorizer !== 'function')
      throw new Error('This Electron runtime lacks SQLite query authorization.');
    db.exec('PRAGMA hard_heap_limit = 33554432; PRAGMA temp_store = MEMORY; PRAGMA trusted_schema = OFF;');
    const { source, preview } = JSON.parse(draft);
    try {
      db.exec(compile(source, 'sqlite', preview).script);
    } catch (error) {
      throw new Error('Could not load the draft: ' + error.message);
    }
    db.exec('PRAGMA query_only = ON;');
    if (db.limits) {
      db.limits.length = 2_000_000;
      db.limits.column = maxColumns;
    }

    let denied = false;
    db.setAuthorizer((action, _arg1, arg2) => {
      if (
        readActions.has(action) ||
        (action === constants.SQLITE_FUNCTION && !unsafeFunctions.has(arg2?.toLowerCase()))
      )
        return constants.SQLITE_OK;
      denied = true;
      return constants.SQLITE_DENY;
    });

    try {
      const statement = db.prepare(query);
      const tail = query.slice(statement.sourceSQL.length);
      if (!/^(?:\s|--[^\r\n]*|\/\*[\s\S]*?\*\/)*$/.test(tail)) throw new Error('Run one SQL query at a time.');
      const columns = statement.columns().map(column => formatValue(column.name));
      if (!columns.length) throw new Error('Enter a SELECT query.');
      if (columns.length > maxColumns) throw new Error('Select at most ' + maxColumns + ' result columns.');
      statement.setReadBigInts(true);
      statement.setReturnArrays(true);
      const rows = [];
      for (const row of statement.iterate()) {
        if (rows.length === maxRows) return { columns, rows, truncated: true };
        rows.push(row.map(formatValue));
      }
      return { columns, rows, truncated: false };
    } catch (error) {
      if (denied) throw new Error('Only read-only SQL queries are allowed in the sandbox.');
      throw error;
    }
  } finally {
    db.close();
  }
}

process.parentPort.once('message', ({ data }) => {
  try {
    process.parentPort.postMessage({ result: runQuery(data) });
  } catch (error) {
    process.parentPort.postMessage({ error: error.message });
  }
});
