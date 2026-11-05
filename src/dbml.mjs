import { compile, dialects, fieldTypes } from './schema.mjs';

const identifier = /^[a-z_]\w{0,62}$/i;
const typeFallback = {
  postgresql: { datetime: 'timestamp', tinyint: 'smallint', string: 'varchar(255)', float: 'real', double: 'double' },
  mysql: { uuid: 'varchar(36)', jsonb: 'json', timestamptz: 'timestamp', string: 'varchar(255)', integer: 'int' },
  sqlite: { uuid: 'text', json: 'text', jsonb: 'text', timestamptz: 'timestamp', string: 'text', serial: 'integer', bigserial: 'integer' },
};

function strip(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function name(raw, what) {
  const last = raw.trim().replace(/^"(.*)"$/, '$1').split('.').pop().replace(/^"(.*)"$/, '$1');
  if (!identifier.test(last)) throw new Error('DBML ' + what + ' "' + raw.trim() + '" is not a valid identifier (ASCII letters, digits and underscore).');
  return last;
}

// Splits text at top-level commas, keeping brackets, parentheses and quotes together.
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of text) {
    if (quote) { current += char; if (char === quote) quote = ''; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) depth--;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function readSettings(text) {
  const match = text?.match(/\[([\s\S]*)\]\s*$/);
  return match ? splitTop(match[1]) : [];
}

function defaultToken(raw) {
  const value = raw.trim();
  if (/^`.*`$/.test(value) || /^(now|current_timestamp)(\(\))?$/i.test(value)) return /now|current_timestamp/i.test(value) ? 'now' : null;
  if (/^(['"]).*\1$/.test(value)) return JSON.stringify(value.slice(1, -1));
  if (/^(true|false|null)$/i.test(value)) return value.toLowerCase();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return JSON.stringify(Number(value));
  return null;
}

const actions = { cascade: 'cascade', restrict: 'restrict', 'set null': 'set_null', 'no action': 'no_action' };

function parseRef(text, tables, warnings) {
  const match = text.match(/^([\w".]+)\s*([<>-])\s*([\w".]+)\s*(\[[\s\S]*\])?/);
  if (!match) throw new Error('Unsupported DBML relationship: ' + text.slice(0, 60));
  const side = value => {
    const parts = value.split('.').map(part => part.replace(/^"(.*)"$/, '$1'));
    if (parts.length < 2) throw new Error('A DBML relationship needs table.column on both sides.');
    return { table: parts.at(-2), column: parts.at(-1) };
  };
  let [from, to] = [side(match[1]), side(match[3])];
  if (match[2] === '<') [from, to] = [to, from];
  const holder = tables.get(from.table)?.columns.find(column => column.name === from.column);
  if (!holder) throw new Error('Relationship uses unknown column ' + from.table + '.' + from.column);
  if (!tables.get(to.table)?.columns.some(column => column.name === to.column)) throw new Error('Relationship uses unknown column ' + to.table + '.' + to.column);
  holder.ref = to.table + '.' + to.column;
  for (const setting of readSettings(match[4])) {
    const [key, ...rest] = setting.split(':');
    if (key.trim().toLowerCase() !== 'delete') continue;
    const action = actions[rest.join(':').trim().toLowerCase()];
    if (action) holder.ondelete = action;
    else warnings.push('Ignored delete action "' + rest.join(':').trim() + '" on ' + from.table + '.' + from.column);
  }
}

function mapType(raw, dialect, location, warnings, enums) {
  const type = raw.trim().replace(/\s+/g, '');
  const base = type.toLowerCase().replace(/\(.*\)/, '');
  if (enums.has(base)) {
    warnings.push(location + ': enum ' + raw + ' became varchar(64).');
    return 'varchar(64)';
  }
  if (fieldTypes[dialect].includes(base) || fieldTypes[dialect].includes(type.replace(/\(.*\)/, ''))) return type.replace(/^([a-z]+)/i, text => text.toLowerCase());
  const fallback = typeFallback[dialect]?.[base];
  if (fallback) {
    warnings.push(location + ': ' + raw + ' became ' + fallback + ' for ' + dialects[dialect] + '.');
    return fallback;
  }
  warnings.push(location + ': unknown type ' + raw + ' became text.');
  return 'text';
}

export function importDbml(input, dialect, fallback = 'imported') {
  if (!Object.hasOwn(dialects, dialect) || dialect === 'mongodb') throw new Error('Choose a SQL engine before importing DBML.');
  if (typeof input !== 'string' || input.length > 700_000) throw new Error('DBML input exceeds the import limit.');
  const text = strip(input);
  const warnings = [];
  const tables = new Map();
  const enums = new Set();
  const refs = [];
  let database = fallback;
  const blockPattern = /(^|\n)\s*(Project|Table|TableGroup|Enum|Ref|Note)\b([^{\n:[]*(?:\[[^\]\n]*\][^{\n:[]*)*)(?:\{|:)/gi;
  let match;
  const readBlock = start => {
    let depth = 1;
    let at = start;
    let quote = '';
    for (; at < text.length && depth; at++) {
      const char = text[at];
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    if (depth) throw new Error('DBML has an unclosed { block.');
    return [text.slice(start, at - 1), at];
  };
  while ((match = blockPattern.exec(text))) {
    const kind = match[2].toLowerCase();
    const opener = text[blockPattern.lastIndex - 1];
    if (opener === ':') {
      if (kind === 'ref') refs.push(text.slice(blockPattern.lastIndex, text.indexOf('\n', blockPattern.lastIndex) === -1 ? undefined : text.indexOf('\n', blockPattern.lastIndex)).trim());
      continue;
    }
    const [body, end] = readBlock(blockPattern.lastIndex);
    blockPattern.lastIndex = end;
    const header = match[3].trim();
    if (kind === 'project') database = header ? name(header.split(/\s+/)[0], 'project name') : database;
    else if (kind === 'enum') enums.add(name(header, 'enum name').toLowerCase());
    else if (kind === 'ref') refs.push(body.trim());
    else if (kind === 'table') {
      const tableName = name(header.replace(/\s+as\s+\S+/i, '').replace(/\[.*\]/, ''), 'table name');
      if (tables.has(tableName)) throw new Error('DBML table ' + tableName + ' is declared twice.');
      tables.set(tableName, { name: tableName, body, columns: [], indexes: [], primary: [] });
    }
  }
  if (!tables.size) throw new Error('No DBML tables found.');

  for (const table of tables.values()) {
    const lines = [];
    let depth = 0;
    let indexBlock = '';
    for (const raw of table.body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^indexes\s*\{/i.test(line)) { depth = 1; continue; }
      if (depth) {
        if (line === '}') { depth = 0; table.indexBlock = indexBlock; continue; }
        indexBlock += line + '\n';
        continue;
      }
      if (/^note\b/i.test(line) || /^\}$/.test(line)) continue;
      lines.push(line);
    }
    for (const line of lines) {
      const match = line.match(/^("[^"]+"|\w+)\s+([^\s\[]+(?:\([^)]*\))?)\s*(\[[\s\S]*\])?$/);
      if (!match) throw new Error('Cannot read DBML column in ' + table.name + ': ' + line.slice(0, 60));
      const column = { name: name(match[1], 'column name'), type: '', pk: false, required: false, unique: false, ref: null };
      column.type = mapType(match[2], dialect, table.name + '.' + column.name, warnings, enums);
      let increment = false;
      for (const setting of readSettings(match[3])) {
        const lower = setting.toLowerCase();
        if (lower === 'pk' || lower === 'primary key') column.pk = true;
        else if (lower === 'not null') column.required = true;
        else if (lower === 'unique') column.unique = true;
        else if (lower === 'increment') increment = true;
        else if (lower.startsWith('default:')) {
          const value = defaultToken(setting.slice(setting.indexOf(':') + 1));
          if (value === null) warnings.push(table.name + '.' + column.name + ': default ' + setting.slice(8).trim() + ' was skipped.');
          else column.default = value;
        } else if (lower.startsWith('ref:')) refs.push(table.name + '.' + column.name + ' ' + setting.slice(4).trim());
      }
      if (increment) warnings.push(table.name + '.' + column.name + ': auto increment is not part of the Schema Studio syntax and was skipped.');
      table.columns.push(column);
    }
    for (const entry of table.indexBlock?.split('\n').filter(Boolean) ?? []) {
      const match = entry.match(/^(\([^)]*\)|\w+)\s*(\[[\s\S]*\])?$/);
      if (!match) { warnings.push(table.name + ': skipped index ' + entry.slice(0, 40)); continue; }
      const columns = match[1].replace(/[()]/g, '').split(',').map(item => name(item, 'index column'));
      const settings = readSettings(match[2]).map(item => item.toLowerCase());
      if (settings.includes('pk')) { table.primary = columns; continue; }
      const given = readSettings(match[2]).find(item => /^name\s*:/i.test(item))?.split(':')[1].trim().replace(/^['"]|['"]$/g, '');
      table.indexes.push({ name: given && identifier.test(given) ? given : table.name + '_' + columns.join('_') + '_idx', unique: settings.includes('unique'), columns });
    }
  }
  for (const ref of refs) parseRef(ref, tables, warnings);

  const lines = ['database ' + database];
  for (const table of tables.values()) {
    lines.push('', 'table ' + table.name + ' {');
    for (const column of table.columns) {
      const parts = [column.name, column.type];
      if (column.pk && !table.primary.length) parts.push('pk');
      if (column.required) parts.push('required');
      if (column.unique) parts.push('unique');
      if (column.default !== undefined) parts.push('default', column.default);
      if (column.ref) parts.push('ref', column.ref);
      if (column.ondelete) parts.push('ondelete', column.ondelete);
      lines.push('  ' + parts.join(' '));
    }
    if (table.primary.length) lines.push('  primary (' + table.primary.join(', ') + ')');
    for (const index of table.indexes) lines.push('  index ' + (index.unique ? 'unique ' : '') + index.name + ' (' + index.columns.join(', ') + ')');
    lines.push('}');
  }
  const source = lines.join('\n') + '\n';
  compile(source, dialect);
  return { source, warnings };
}

export function exportDbml(schema) {
  const value = field => {
    if (!field.default) return '';
    const { kind, value } = field.default;
    return kind === 'now' ? 'default: `now()`' : 'default: ' + (typeof value === 'string' ? "'" + value.replaceAll("'", "\\'") + "'" : String(value));
  };
  const lines = ['Project ' + schema.database + ' {', "  Note: 'Exported from Schema Studio'", '}'];
  const refs = [];
  for (const entity of schema.entities) {
    lines.push('', 'Table ' + entity.name + ' {');
    for (const field of entity.fields) {
      const settings = [
        entity.primary.length === 1 && entity.primary[0] === field.name && 'pk',
        (field.required || entity.primary.includes(field.name)) && !(entity.primary.length === 1 && entity.primary[0] === field.name) && 'not null',
        field.unique && 'unique', value(field),
      ].filter(Boolean);
      lines.push('  ' + field.name + ' ' + field.type + (settings.length ? ' [' + settings.join(', ') + ']' : ''));
      if (field.ref) {
        const action = Object.entries(actions).find(([, mapped]) => mapped === field.ondelete?.toLowerCase().replace(' ', '_'))?.[0];
        refs.push('Ref: ' + entity.name + '.' + field.name + ' > ' + field.ref.entity + '.' + field.ref.field + (action ? ' [delete: ' + action + ']' : ''));
      }
    }
    const indexes = [...(entity.primary.length > 1 ? [{ columns: entity.primary, pk: true }] : []), ...entity.indexes];
    if (indexes.length) {
      lines.push('', '  indexes {');
      for (const index of indexes) {
        const flags = [index.pk && 'pk', index.unique && 'unique', index.name && "name: '" + index.name + "'"].filter(Boolean);
        lines.push('    ' + (index.columns.length > 1 ? '(' + index.columns.join(', ') + ')' : index.columns[0]) + (flags.length ? ' [' + flags.join(', ') + ']' : ''));
      }
      lines.push('  }');
    }
    lines.push('}');
  }
  return [...lines, ...(refs.length ? ['', ...refs] : [])].join('\n') + '\n';
}
