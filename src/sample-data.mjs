import { validatePreviewValue } from './preview-values.mjs';

const firstNames = ['Ada', 'Linus', 'Grace', 'Alan', 'Edsger', 'Barbara', 'Dennis', 'Margaret'];
const pad = (value, size = 2) => String(value).padStart(size, '0');

// Values depend only on (field, row number), so a foreign key can always be computed from its parent's key
// without generating the parent first. No randomness: the same schema always produces the same rows.
function raw(field, dialect, row, unique) {
  const declaration = field.type.toLowerCase();
  const [type] = declaration.split(/[(\[]/);
  const [size, scale] = (declaration.match(/\((\d+)(?:,(\d+))?\)/)?.slice(1) ?? []).map(Number);
  const n = row + 1;
  const mongo = dialect === 'mongodb';
  if (declaration.endsWith('[]')) return '[]';
  switch (type) {
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'integer':
    case 'int':
    case 'bigint':
    case 'serial':
    case 'bigserial':
    case 'long':
      return String(n);
    case 'decimal':
    case 'numeric':
      return scale ? n * 10 + '.' + '5'.padEnd(scale, '0').slice(0, scale) : String(n * 10);
    case 'real':
    case 'float':
    case 'double':
      return n * 10 + '.5';
    case 'boolean':
    case 'bool':
      return row % 2 === 0 ? 'true' : 'false';
    case 'date':
      return mongo ? '2026-01-' + pad((row % 28) + 1) + 'T00:00:00Z' : '2026-01-' + pad((row % 28) + 1);
    case 'time':
      return '09:' + pad(row % 60) + ':00';
    case 'timestamp':
      return mongo
        ? JSON.stringify({ t: 1767225600 + row * 3600, i: 1 })
        : '2026-01-' + pad((row % 28) + 1) + ' 09:00:00';
    case 'datetime':
      return '2026-01-' + pad((row % 28) + 1) + ' 09:00:00';
    case 'timestamptz':
      return '2026-01-' + pad((row % 28) + 1) + 'T09:00:00Z';
    case 'json':
    case 'jsonb':
    case 'object':
      return '{}';
    case 'array':
      return '[]';
    case 'uuid':
      return '00000000-0000-4000-8000-' + pad(n, 12);
    case 'objectid':
      return pad(n, 24);
    case 'blob':
    case 'bytea':
    case 'binary':
    case 'varbinary':
      return pad(n.toString(16), 2);
    case 'bindata':
      return 'AAEC';
    case 'inet':
      return '10.0.0.' + ((n % 250) + 1);
    case 'interval':
      return 'P' + n + 'D';
    default: {
      const name = field.name.toLowerCase();
      let text;
      if (/e?mail/.test(name)) text = 'user' + n + '@example.test';
      else if (/(^|_)name$|^name/.test(name))
        text = firstNames[row % firstNames.length] + (unique && row >= firstNames.length ? ' ' + n : '');
      else if (/status|state/.test(name)) text = ['new', 'active', 'done'][row % 3];
      else if (/phone/.test(name)) text = '08' + pad(n, 8);
      else if (/title|subject/.test(name)) text = 'Sample ' + name + ' ' + n;
      else text = name + '_' + n;
      return size ? text.slice(0, size) : text;
    }
  }
}

export function generateSampleRows(schema, dialect, count = 5) {
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error('Choose between 1 and 200 rows per table.');
  const entities = new Map(schema.entities.map(entity => [entity.name, entity]));
  const rows = {};
  function value(entity, field, row) {
    if (field.ref) {
      const target = entities.get(field.ref.entity);
      const parent = target.fields.find(item => item.name === field.ref.field);
      return value(target, parent, row % count);
    }
    const unique =
      field.unique ||
      (entity.primary.includes(field.name) && entity.primary.length === 1) ||
      entity.indexes.some(index => index.unique && index.columns.length === 1 && index.columns[0] === field.name);
    if (
      !unique &&
      field.default?.kind === 'literal' &&
      typeof field.default.value !== 'object' &&
      field.default.value !== null
    )
      return String(field.default.value);
    const result = raw(field, dialect, row, unique);
    const message = validatePreviewValue(field.type, result, dialect, true);
    if (message)
      throw new Error(
        'Cannot generate a sample for ' + entity.name + '.' + field.name + ' (' + field.type + '): ' + message
      );
    return result;
  }
  for (const entity of schema.entities) {
    const list = [];
    for (let row = 0; row < count; row++) {
      list.push(Object.fromEntries(entity.fields.map(field => [field.name, value(entity, field, row)])));
    }
    rows[schema.database + '.' + entity.name] = list;
  }
  return rows;
}
