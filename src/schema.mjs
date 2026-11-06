import { seedStatements, sqlIdentifier } from './seed.mjs';

export const dialects = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
};

const types = {
  postgresql:
    'smallint integer int bigint serial bigserial boolean bool text varchar char numeric decimal real float double uuid json jsonb date time timestamp timestamptz bytea inet interval',
  mysql:
    'tinyint smallint mediumint int integer bigint boolean bool text tinytext mediumtext longtext varchar char decimal numeric float double json date time datetime timestamp blob binary varbinary',
  sqlite:
    'integer int bigint smallint text varchar char real double float numeric decimal boolean blob date datetime timestamp',
  mongodb: 'objectId string bool int long double decimal date timestamp object array binData null regex',
};
export const fieldTypes = Object.fromEntries(
  Object.entries(types).map(([dialect, values]) => [dialect, values.split(' ')])
);
export const mysqlCollations = {
  utf8mb4: ['utf8mb4_0900_ai_ci', 'utf8mb4_0900_as_cs', 'utf8mb4_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
  ascii: ['ascii_general_ci', 'ascii_bin'],
  tis620: ['tis620_thai_ci', 'tis620_bin'],
};
const identifier = /^[a-z_][a-z_0-9]*$/i;
const actions = { cascade: 'CASCADE', restrict: 'RESTRICT', set_null: 'SET NULL', no_action: 'NO ACTION' };

function fail(line, message) {
  throw new Error(line ? 'Line ' + line + ': ' + message : message);
}

function parse(source, dialect) {
  if (typeof source !== 'string' || source.length > 100_000) fail(0, 'Source must be text up to 100,000 characters.');
  const mongo = dialect === 'mongodb';
  const entities = [];
  let database, entity, databaseOptions;
  for (const [offset, raw] of source.split(/\r?\n/).entries()) {
    const line = offset + 1;
    const input = raw.trim();
    if (!input || input.startsWith('//') || input.startsWith('#')) continue;
    const tokens = input.match(/"(?:\\.|[^"\\])*"|\S+/g);
    const [keyword, name] = tokens;
    if (!entity) {
      if (!identifier.test(name ?? '') || name.length > 63)
        fail(line, 'Expected an identifier up to 63 ASCII characters.');
      if (keyword === 'database' && !database && !entities.length) {
        database = name;
        if (tokens.length > 2) {
          if (dialect !== 'mysql') fail(line, 'Database charset and collation are supported for MySQL.');
          const [, , charsetKeyword, charsetValue, collateKeyword, collationValue] = tokens;
          if (
            charsetKeyword !== 'charset' ||
            ![4, 6].includes(tokens.length) ||
            (tokens.length === 6 && collateKeyword !== 'collate')
          ) {
            fail(line, 'Use database NAME charset CHARSET [collate COLLATION].');
          }
          const charset = charsetValue.toLowerCase();
          const collation = collationValue?.toLowerCase();
          if (!Object.hasOwn(mysqlCollations, charset)) fail(line, 'Unsupported MySQL charset ' + charset);
          if (collation && !mysqlCollations[charset].includes(collation)) {
            fail(line, 'Unsupported collation ' + collation + ' for ' + charset);
          }
          databaseOptions = { charset, ...(collation ? { collation } : {}) };
        }
        continue;
      }
      if (!database || keyword !== (mongo ? 'collection' : 'table') || tokens.length !== 3 || tokens[2] !== '{') {
        fail(line, 'Start with database NAME, then ' + (mongo ? 'collection' : 'table') + ' NAME {.');
      }
      if (entities.some(item => item.name.toLowerCase() === name.toLowerCase())) fail(line, 'Duplicate entity ' + name);
      entity = { name, line, fields: [], indexes: [], primary: [] };
      entities.push(entity);
      continue;
    }
    if (input === '}') {
      if (!entity.fields.length) fail(line, entity.name + ' needs at least one field.');
      entity = undefined;
      continue;
    }
    const index = input.match(/^index\s+(?:(unique)\s+)?([a-z_]\w*)\s+\(([^()]+)\)$/i);
    const primary = input.match(/^primary\s+\(([^()]+)\)$/i);
    if (index || primary) {
      const columns = (index ? index[3] : primary[1]).split(',').map(value => value.trim());
      if (columns.some(column => !identifier.test(column)) || new Set(columns).size !== columns.length)
        fail(line, 'Invalid or duplicate index/key field.');
      if (index) {
        if (index[2].length > 63) fail(line, 'Index name exceeds 63 characters.');
        entity.indexes.push({ name: index[2], unique: Boolean(index[1]), columns, line });
      } else {
        if (mongo || entity.primary.length) fail(line, 'Use one SQL primary declaration.');
        entity.primary = columns;
      }
      continue;
    }

    const [fieldName, type, ...options] = tokens;
    if (!identifier.test(fieldName) || fieldName.length > 63 || fieldName === '__proto__')
      fail(line, 'Invalid field name.');
    if (entity.fields.some(field => field.name.toLowerCase() === fieldName.toLowerCase()))
      fail(line, 'Duplicate field ' + fieldName);
    const shape = type?.match(/^([a-z]+)(\((\d+)(?:,(\d+))?\))?(\[\])?$/i);
    const base = mongo ? shape?.[1] : shape?.[1].toLowerCase();
    if (
      !shape ||
      !fieldTypes[dialect].includes(base) ||
      (shape[5] && dialect !== 'postgresql') ||
      (shape[2] && !['varchar', 'char', 'numeric', 'decimal', 'binary', 'varbinary'].includes(base)) ||
      (shape[4] && !['decimal', 'numeric'].includes(base)) ||
      (shape[2] && (Number(shape[3]) < 1 || Number(shape[4]) > Number(shape[3]))) ||
      (dialect === 'mysql' && ['varchar', 'varbinary'].includes(base) && !shape[2])
    ) {
      fail(line, 'Unsupported ' + dialects[dialect] + ' type: ' + (type ?? '(missing)'));
    }

    const field = { name: fieldName, type, line };
    const seen = new Set();
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (seen.has(option)) fail(line, 'Duplicate modifier ' + option);
      seen.add(option);
      if (['pk', 'required', 'unique'].includes(option)) {
        field[option] = true;
      } else if (option === 'ref') {
        const target = options[++i]?.match(/^([a-z_]\w*)\.([a-z_]\w*)$/i);
        if (!target) fail(line, 'Expected ref ENTITY.FIELD.');
        field.ref = { entity: target[1], field: target[2] };
      } else if (option === 'ondelete' && !mongo) {
        const action = options[++i];
        if (!Object.hasOwn(actions, action)) fail(line, 'Expected cascade, restrict, set_null or no_action.');
        field.ondelete = actions[action];
      } else if (option === 'default' && !mongo) {
        const value = options[++i];
        if (value === 'now') {
          field.default = { kind: 'now' };
          continue;
        }
        try {
          const literal = JSON.parse(value);
          if (
            (typeof literal === 'object' && literal !== null) ||
            (typeof literal === 'number' && !Number.isFinite(literal))
          )
            throw new Error();
          if (typeof literal === 'string' && /[\u0000-\u001f]/.test(literal)) throw new Error();
          field.default = { kind: 'literal', value: literal };
        } catch {
          fail(line, 'Use a JSON string, number, boolean, null, or now as a default.');
        }
      } else {
        fail(line, 'Unknown modifier ' + option);
      }
    }
    if (mongo && field.pk && field.name !== '_id') fail(line, 'MongoDB primary keys use _id.');
    if (mongo && field.name === '_id' && ['array', 'regex'].includes(base)) fail(line, 'Unsupported _id type.');
    if (field.ondelete && !field.ref) fail(line, 'ondelete requires ref.');
    entity.fields.push(field);
  }
  if (entity) fail(entity.line, 'Missing closing brace for ' + entity.name);
  if (!database || !entities.length) fail(0, 'Declare a database and at least one entity.');
  return { database, ...(databaseOptions ? { databaseOptions } : {}), entities };
}

function validate(schema, dialect) {
  const mongo = dialect === 'mongodb';
  const names = new Set(dialect === 'mysql' || mongo ? [] : schema.entities.map(entity => entity.name.toLowerCase()));
  const entities = new Map(schema.entities.map(entity => [entity.name, entity]));
  for (const entity of schema.entities) {
    const fields = new Map(entity.fields.map(field => [field.name, field]));
    const marked = entity.fields.filter(field => field.pk).map(field => field.name);
    if (entity.primary.length && marked.length) fail(entity.line, 'Choose pk modifiers or a primary declaration.');
    entity.primary = entity.primary.length ? entity.primary : marked;
    const indexNames = dialect === 'mysql' || mongo ? new Set() : names;
    for (const index of entity.indexes) {
      const name = index.name.toLowerCase();
      if (indexNames.has(name) || (dialect === 'mysql' && name === 'primary') || (mongo && name === '_id_'))
        fail(index.line, 'Duplicate or reserved index name ' + index.name);
      indexNames.add(name);
    }
    for (const key of [...entity.indexes, { columns: entity.primary, line: entity.line }]) {
      for (const column of key.columns) if (!fields.has(column)) fail(key.line, 'Unknown field ' + column);
    }
  }
  for (const entity of schema.entities) {
    for (const field of entity.fields) {
      const required = field.required || entity.primary.includes(field.name);
      if (required && field.default?.value === null) fail(field.line, 'Required fields cannot default to null.');
      if (required && field.ondelete === 'SET NULL') fail(field.line, 'SET NULL requires a nullable field.');
      if (!field.ref) continue;
      const target = entities.get(field.ref.entity);
      const targetField = target?.fields.find(item => item.name === field.ref.field);
      const label = field.ref.entity + '.' + field.ref.field;
      if (!targetField) fail(field.line, 'Unknown reference ' + label);
      if (mongo) continue;
      const unique =
        targetField.unique ||
        (target.primary.length === 1 && target.primary[0] === targetField.name) ||
        target.indexes.some(
          index => index.unique && index.columns.length === 1 && index.columns[0] === targetField.name
        );
      if (!unique) fail(field.line, 'Reference must point to a single-column unique key: ' + label);
    }
  }
}

export function sqlColumn(field, entity, dialect) {
  const type = field.type.toUpperCase();
  const sqlType = dialect === 'postgresql' ? type.replace(/^DOUBLE(?=\[\]|$)/, 'DOUBLE PRECISION') : type;
  let definition = sqlIdentifier(field.name, dialect) + ' ' + sqlType;
  if (field.required || entity.primary.includes(field.name)) definition += ' NOT NULL';
  if (field.unique) definition += ' UNIQUE';
  if (field.default) {
    const { value, kind } = field.default;
    let literal = String(value).toUpperCase();
    if (typeof value === 'string') {
      const escaped = value.replaceAll("'", "''");
      literal =
        "'" + (dialect === 'mysql' || dialect === 'postgresql' ? escaped.replaceAll('\\', '\\\\') : escaped) + "'";
      if (dialect === 'postgresql') literal = 'E' + literal;
    }
    definition += ' DEFAULT ' + (kind === 'now' ? 'CURRENT_TIMESTAMP' : literal);
  }
  return definition;
}

export function sqlStatements(schema, dialect, includeDatabase = true, seeds = []) {
  const mysql = dialect === 'mysql';
  const sqlite = dialect === 'sqlite';
  const id = value => sqlIdentifier(value, dialect);
  const columns = names => '(' + names.map(id).join(', ') + ')';
  const lines = ['-- Schema Studio | ' + dialects[dialect] + ' | ' + schema.database];
  if (includeDatabase && sqlite) lines.push('PRAGMA foreign_keys = ON;');
  else if (includeDatabase && mysql) {
    const { charset, collation } = schema.databaseOptions ?? {};
    const options = (charset ? ' CHARACTER SET ' + charset : '') + (collation ? ' COLLATE ' + collation : '');
    lines.push('CREATE DATABASE ' + id(schema.database) + options + ';', 'USE ' + id(schema.database) + ';');
  } else if (includeDatabase)
    lines.push(
      '-- Run with psql while connected to a maintenance database.',
      'CREATE DATABASE ' + id(schema.database) + ';',
      '\\connect ' + id(schema.database)
    );
  const alters = [];
  const indexes = [];
  for (const entity of schema.entities) {
    const definitions = entity.fields.map(field => {
      let definition = sqlColumn(field, entity, dialect);
      if (field.ref) {
        const clause =
          'FOREIGN KEY ' +
          columns([field.name]) +
          ' REFERENCES ' +
          id(field.ref.entity) +
          ' ' +
          columns([field.ref.field]) +
          (field.ondelete ? ' ON DELETE ' + field.ondelete : '');
        if (!sqlite) alters.push('ALTER TABLE ' + id(entity.name) + ' ADD ' + clause + ';');
        if (sqlite) definition += ' ' + clause.slice(clause.indexOf('REFERENCES'));
      }
      return definition;
    });
    if (entity.primary.length) definitions.push('PRIMARY KEY ' + columns(entity.primary));
    lines.push(
      '',
      'CREATE TABLE ' +
        id(entity.name) +
        ' (\n  ' +
        definitions.join(',\n  ') +
        '\n)' +
        (mysql ? ' ENGINE=InnoDB' : '') +
        ';'
    );
    for (const index of entity.indexes) {
      indexes.push(
        'CREATE ' +
          (index.unique ? 'UNIQUE ' : '') +
          'INDEX ' +
          id(index.name) +
          ' ON ' +
          id(entity.name) +
          ' ' +
          columns(index.columns) +
          ';'
      );
    }
  }
  const data = seeds.length
    ? [
        '',
        '-- Draft preview rows',
        ...(sqlite ? ['BEGIN;', 'PRAGMA defer_foreign_keys = ON;', ...seeds, 'COMMIT;'] : seeds),
      ]
    : [];
  return (
    [...lines, ...(indexes.length ? ['', ...indexes] : []), ...data, ...(alters.length ? ['', ...alters] : [])].join(
      '\n'
    ) + '\n'
  );
}

function mongoScript(schema) {
  const lines = [
    '// Schema Studio | MongoDB (mongosh)',
    '// References are diagram metadata.',
    'const target = db.getSiblingDB(' + JSON.stringify(schema.database) + ');',
  ];
  for (const entity of schema.entities) {
    const required = entity.fields.filter(field => field.required || field.pk).map(field => field.name);
    const validator = {
      $jsonSchema: {
        bsonType: 'object',
        ...(required.length ? { required } : {}),
        properties: Object.fromEntries(entity.fields.map(field => [field.name, { bsonType: field.type }])),
      },
    };
    const name = JSON.stringify(entity.name);
    lines.push('', 'target.createCollection(' + name + ', ' + JSON.stringify({ validator }, null, 2) + ');');
    const indexes = [
      ...entity.indexes,
      ...entity.fields
        .filter(field => field.unique && field.name !== '_id')
        .map(field => ({
          unique: true,
          columns: [field.name],
        })),
    ];
    for (const index of indexes) {
      const keys = Object.fromEntries(index.columns.map(column => [column, 1]));
      const options = { ...(index.name ? { name: index.name } : {}), ...(index.unique ? { unique: true } : {}) };
      lines.push(
        'target.getCollection(' + name + ').createIndex(' + JSON.stringify(keys) + ', ' + JSON.stringify(options) + ');'
      );
    }
  }
  return lines.join('\n') + '\n';
}

export function compile(source, dialect, preview) {
  if (!Object.hasOwn(dialects, dialect)) fail(0, 'Unknown database engine.');
  const schema = parse(source, dialect);
  validate(schema, dialect);
  const mongo = dialect === 'mongodb';
  const seeds = preview ? seedStatements(schema, dialect, preview) : [];
  const script = mongo
    ? mongoScript(schema) + (seeds.length ? '\n// Draft preview rows\n' + seeds.join('\n') + '\n' : '')
    : sqlStatements(schema, dialect, true, seeds);
  return { schema, script, extension: mongo ? 'js' : 'sql' };
}
