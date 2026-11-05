import { validatePreviewValue } from './preview-values.mjs';

const numbers = /^(?:tinyint|smallint|mediumint|integer|int|bigint|serial|bigserial|long|decimal|numeric|real|float|double)$/;
export const previewRows = (preview, database, entity) => preview[database + '.' + entity] ?? [];

export function referenceValues(preview, database, ref) {
  return [...new Set(previewRows(preview, database, ref.entity)
    .map(row => Object.hasOwn(row, ref.field) ? row[ref.field] : '')
    .filter(value => value !== ''))];
}

export function sqlIdentifier(name, dialect) {
  const quote = dialect === 'mysql' ? String.fromCharCode(96) : '"';
  return quote + name + quote;
}

function sqlText(value, dialect) {
  if (value.includes('\0')) throw new Error('SQL text values cannot contain a NUL character.');
  if (dialect === 'mysql') {
    const hex = Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');
    return hex ? 'CONVERT(0x' + hex + ' USING utf8mb4)' : "''";
  }
  const quoted = value.replaceAll("'", "''");
  return dialect === 'postgresql' ? "E'" + quoted.replaceAll('\\', '\\\\') + "'" : "'" + quoted + "'";
}

function sqlValue(raw, declaration, dialect) {
  const type = declaration.toLowerCase().split(/[(\[]/)[0];
  const value = raw.trim();
  if (declaration.endsWith('[]')) {
    const base = declaration.slice(0, -2);
    const array = items => 'ARRAY[' + items.map(item => item === null ? 'NULL' :
      Array.isArray(item) && !['json', 'jsonb'].includes(type) ? array(item) :
        sqlValue(['json', 'jsonb'].includes(type) ? JSON.stringify(item) : String(item), base, dialect)).join(', ') + ']';
    return array(JSON.parse(value)) + '::' + base.replace(/^double$/i, 'double precision') + '[]';
  }
  if (numbers.test(type)) return value;
  if (type === 'boolean' || type === 'bool') return /^(true|1)$/i.test(value) ? 'TRUE' : 'FALSE';
  if (/^(blob|bytea|binary|varbinary)$/.test(type)) {
    const hex = value.replace(/^(?:0x|\\x)/i, '');
    return dialect === 'postgresql' ? "decode('" + hex + "', 'hex')" : "X'" + hex + "'";
  }
  return sqlText(raw, dialect);
}

function mongoValue(raw, type) {
  const value = raw.trim();
  const quoted = JSON.stringify(value);
  switch (type) {
    case 'int': return 'NumberInt(' + JSON.stringify(String(Number(value))) + ')';
    case 'long': return 'NumberLong(' + JSON.stringify(BigInt(value).toString()) + ')';
    case 'double': return 'Double(' + String(Number(value)) + ')';
    case 'decimal': return 'NumberDecimal(' + quoted + ')';
    case 'objectId': return 'ObjectId(' + quoted + ')';
    case 'date': return 'ISODate(' + quoted + ')';
    case 'binData': return 'BinData(0, ' + quoted + ')';
    case 'regex': return 'BSONRegExp(' + quoted + ', "")';
    case 'timestamp': {
      const { t, i } = JSON.parse(value);
      return 'Timestamp({ t: ' + t + ', i: ' + i + ' })';
    }
    case 'bool': return value.toLowerCase();
    case 'null': return 'null';
    case 'array':
    case 'object': return 'JSON.parse(' + quoted + ')';
    default: return JSON.stringify(raw);
  }
}

export function seedStatements(schema, dialect, preview) {
  const mongo = dialect === 'mongodb';
  const id = name => sqlIdentifier(name, dialect);
  const statements = [];
  const entities = new Map(schema.entities.map(entity => [entity.name, entity]));
  const visited = new Set();
  const ordered = [];
  function visit(entity) {
    if (visited.has(entity.name)) return;
    visited.add(entity.name);
    for (const field of entity.fields) if (field.ref) visit(entities.get(field.ref.entity));
    ordered.push(entity);
  }
  schema.entities.forEach(visit);
  for (const entity of ordered) {
    const rows = previewRows(preview, schema.database, entity.name);
    const references = new Map(entity.fields.filter(field => field.ref).map(field =>
      [field.name, new Set(referenceValues(preview, schema.database, field.ref))]));
    for (const [index, row] of rows.entries()) {
      const fields = [];
      const values = [];
      for (const field of entity.fields) {
        const value = Object.hasOwn(row, field.name) ? row[field.name] : '';
        const required = (field.required || entity.primary.includes(field.name)) && !field.default;
        const message = validatePreviewValue(field.type, value, dialect, required);
        const missingReference = value !== '' && field.ref && !references.get(field.name).has(value);
        if (message || missingReference) {
          throw new Error(entity.name + ' row ' + (index + 1) + ' · ' + field.name + '. ' +
            (message || 'No matching value in ' + field.ref.entity + '.' + field.ref.field + '.'));
        }
        if (value === '') continue;
        fields.push(field.name);
        values.push(mongo ? mongoValue(value, field.type) : sqlValue(value, field.type, dialect));
      }
      if (mongo) {
        const pairs = fields.map((field, i) => JSON.stringify(field) + ': ' + values[i]);
        statements.push('target.getCollection(' + JSON.stringify(entity.name) + ').insertOne({ ' + pairs.join(', ') + ' });');
      } else if (fields.length) {
        statements.push('INSERT INTO ' + id(entity.name) + ' (' + fields.map(id).join(', ') + ') VALUES (' + values.join(', ') + ');');
      } else {
        statements.push('INSERT INTO ' + id(entity.name) + (dialect === 'mysql' ? ' () VALUES ();' : ' DEFAULT VALUES;'));
      }
    }
  }
  return statements;
}
