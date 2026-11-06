import { compile, sqlColumn, sqlStatements } from './schema.mjs';
import { sqlIdentifier } from './seed.mjs';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const byName = items => new Map(items.map(item => [item.name, item]));
const fieldSignature = (field, entity) => ({
  type: field.type.toLowerCase(),
  required: Boolean(field.required || entity.primary.includes(field.name)),
  unique: Boolean(field.unique),
  default: field.default,
  reference: field.ref,
  onDelete: field.ref ? (field.ondelete ?? 'NO ACTION') : undefined,
});
const indexSignature = ({ unique, columns }) => ({ unique, columns });

export function compareSchemas(before, after, dialect, { allowDestructive = false } = {}) {
  const base = compile(before, dialect).schema;
  const next = compile(after, dialect).schema;
  const oldTables = byName(base.entities);
  const newTables = byName(next.entities);
  const changes = [];
  const blocked = [];
  const risky = [];
  const phase = { dropIndex: [], dropColumn: [], alter: [], addColumn: [], createIndex: [], dropTable: [] };
  const newEntities = [];
  const id = value => sqlIdentifier(value, dialect);
  const pg = dialect === 'postgresql';
  const mysql = dialect === 'mysql';
  function manual(message) {
    changes.push(message);
    blocked.push(message);
  }
  // A step either becomes SQL, or (when it changes or removes data and that was not allowed) is reported and left out.
  function step(message, where, statements, dangerous = false) {
    changes.push(message);
    if (dangerous) risky.push(message);
    if (dangerous && !allowDestructive) {
      blocked.push(message + ' (removes or rewrites data: allow data-changing statements to include it)');
      return;
    }
    phase[where].push(...[].concat(statements));
  }
  const indexed = (table, column) =>
    table.indexes.some(index => index.columns.includes(column)) || table.primary.includes(column);
  const typeOf = field => sqlColumn({ name: 'x', type: field.type }, { primary: [] }, dialect).replace(/^\S+ /, '');
  const defaultClause = field => {
    const text = sqlColumn(field, { primary: [] }, dialect);
    const at = text.indexOf(' DEFAULT ');
    return at === -1 ? '' : text.slice(at + 9);
  };

  if (base.database !== next.database) manual('Database name: ' + base.database + ' → ' + next.database);
  if (!same(base.databaseOptions, next.databaseOptions)) manual('Change database charset or collation');
  const removed = base.entities.filter(table => !newTables.has(table.name));
  // Tables that point at other removed tables are dropped first.
  removed.sort(
    (a, b) =>
      Number(b.fields.some(field => field.ref?.entity === a.name)) -
      Number(a.fields.some(field => field.ref?.entity === b.name))
  );
  for (const table of removed) {
    if (dialect === 'mongodb') manual('Remove ' + table.name);
    else step('Remove ' + table.name, 'dropTable', 'DROP TABLE ' + id(table.name) + ';', true);
  }
  for (const table of next.entities) {
    const old = oldTables.get(table.name);
    if (!old) {
      changes.push('Add ' + table.name);
      newEntities.push(table);
      continue;
    }
    const oldFields = byName(old.fields);
    const newFields = byName(table.fields);
    const oldIndexes = byName(old.indexes);
    const newIndexes = byName(table.indexes);
    if (!same(old.primary, table.primary)) manual('Change primary key on ' + table.name);
    for (const field of old.fields) {
      if (newFields.has(field.name)) continue;
      const label = 'Remove column ' + table.name + '.' + field.name;
      const needsManual =
        dialect === 'mongodb' ||
        (dialect === 'sqlite' && (field.unique || field.ref || indexed(old, field.name))) ||
        (mysql && field.ref) ||
        old.primary.includes(field.name);
      if (needsManual) manual(label);
      else step(label, 'dropColumn', 'ALTER TABLE ' + id(table.name) + ' DROP COLUMN ' + id(field.name) + ';', true);
    }
    for (const field of table.fields) {
      const previous = oldFields.get(field.name);
      const label = table.name + '.' + field.name;
      if (previous) {
        const beforeField = fieldSignature(previous, old);
        const afterField = fieldSignature(field, table);
        const changed = Object.keys(beforeField).filter(key => !same(beforeField[key], afterField[key]));
        if (!changed.length) continue;
        const summary = 'Change ' + label + ' (' + changed.join(', ') + ')';
        const tableName = id(table.name);
        const column = id(field.name);
        if (
          changed.includes('reference') ||
          changed.includes('onDelete') ||
          dialect === 'sqlite' ||
          dialect === 'mongodb'
        ) {
          manual(summary);
          continue;
        }
        if (changed.includes('unique') && previous.unique) {
          manual(summary + ' (removing a unique constraint needs a manual migration)');
          continue;
        }
        const dangerous =
          changed.some(key => key === 'type' || key === 'unique') ||
          (changed.includes('required') && afterField.required);
        const statements = [];
        if (pg) {
          const type = typeOf(field);
          if (changed.includes('type'))
            statements.push(
              'ALTER TABLE ' +
                tableName +
                ' ALTER COLUMN ' +
                column +
                ' TYPE ' +
                type +
                ' USING ' +
                column +
                '::' +
                type +
                ';'
            );
          if (changed.includes('required'))
            statements.push(
              'ALTER TABLE ' +
                tableName +
                ' ALTER COLUMN ' +
                column +
                (afterField.required ? ' SET NOT NULL;' : ' DROP NOT NULL;')
            );
          if (changed.includes('default'))
            statements.push(
              'ALTER TABLE ' +
                tableName +
                ' ALTER COLUMN ' +
                column +
                (field.default ? ' SET DEFAULT ' + defaultClause(field) + ';' : ' DROP DEFAULT;')
            );
        } else {
          statements.push(
            'ALTER TABLE ' +
              tableName +
              ' MODIFY COLUMN ' +
              sqlColumn({ ...field, unique: false }, table, dialect) +
              ';'
          );
        }
        if (changed.includes('unique')) statements.push('ALTER TABLE ' + tableName + ' ADD UNIQUE (' + column + ');');
        step(summary, 'alter', statements, dangerous);
        continue;
      }
      const required = field.required || table.primary.includes(field.name);
      if (
        field.ref ||
        (required && !field.default) ||
        table.primary.includes(field.name) ||
        (dialect === 'sqlite' && (field.unique || field.default?.kind === 'now'))
      ) {
        manual('Add column ' + label + ' with a constraint or default that needs a manual migration');
      } else {
        step(
          'Add column ' + label,
          'addColumn',
          'ALTER TABLE ' + id(table.name) + ' ADD COLUMN ' + sqlColumn(field, table, dialect) + ';'
        );
      }
    }
    const dropIndex = index =>
      mysql ? 'DROP INDEX ' + id(index.name) + ' ON ' + id(table.name) + ';' : 'DROP INDEX ' + id(index.name) + ';';
    const createIndex = index =>
      'CREATE ' +
      (index.unique ? 'UNIQUE ' : '') +
      'INDEX ' +
      id(index.name) +
      ' ON ' +
      id(table.name) +
      ' (' +
      index.columns.map(id).join(', ') +
      ');';
    for (const index of old.indexes) {
      if (newIndexes.has(index.name)) continue;
      if (dialect === 'mongodb') manual('Remove index ' + table.name + '.' + index.name);
      else step('Remove index ' + table.name + '.' + index.name, 'dropIndex', dropIndex(index));
    }
    for (const index of table.indexes) {
      const previous = oldIndexes.get(index.name);
      const label = table.name + '.' + index.name;
      if (!previous) {
        step('Add index ' + label, 'createIndex', createIndex(index));
      } else if (!same(indexSignature(previous), indexSignature(index))) {
        if (dialect === 'mongodb') manual('Change index ' + label);
        else {
          changes.push('Change index ' + label);
          phase.dropIndex.push(dropIndex(previous));
          phase.createIndex.push(createIndex(index));
        }
      }
    }
  }
  if (dialect === 'mongodb' && changes.length)
    blocked.push('Automatic migration scripts are available for SQL engines.');
  const script =
    changes.length && !blocked.length
      ? [
          '-- Migration for ' + next.database + '. Run on the database that matches the base draft.',
          ...(risky.length
            ? ['-- WARNING: this script changes or removes data (' + risky.join('; ') + '). Back up first.']
            : []),
          ...(dialect === 'sqlite'
            ? ['PRAGMA foreign_keys = ON;', 'BEGIN;']
            : pg
              ? ['BEGIN;']
              : ['USE ' + id(next.database) + ';']),
          ...phase.dropIndex,
          ...phase.dropColumn,
          ...phase.alter,
          ...phase.addColumn,
          ...(newEntities.length ? [sqlStatements({ ...next, entities: newEntities }, dialect, false).trimEnd()] : []),
          ...phase.createIndex,
          ...phase.dropTable,
          ...(mysql ? [] : ['COMMIT;']),
        ].join('\n') + '\n'
      : '';
  return { changes, blocked, risky, script };
}

export function makeProposal(dialect, base, source) {
  const { changes } = compareSchemas(base, source, dialect);
  return { kind: 'schema-studio-proposal', version: 1, dialect, base, source, changes };
}

export function reviewProposal(input, dialect, current) {
  if (input.length > 700_000) throw new Error('Proposal is too large.');
  const proposal = JSON.parse(input);
  if (proposal?.kind !== 'schema-studio-proposal' || proposal.version !== 1 || proposal.dialect !== dialect) {
    throw new Error('Expected a Schema Studio proposal for the current engine.');
  }
  const normalize = value => value.replace(/\r\n/g, '\n').trimEnd();
  if (typeof proposal.base !== 'string' || normalize(proposal.base) !== normalize(current)) {
    throw new Error('The proposal base differs from the current draft. Regenerate the proposal.');
  }
  return makeProposal(dialect, current, proposal.source);
}
