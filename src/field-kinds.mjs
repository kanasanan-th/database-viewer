// Maps a column declaration to the right editor, and converts between the stored text and what native inputs use.
const integers = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'integer',
  'int',
  'serial',
  'bigint',
  'bigserial',
  'long',
]);
const longText = new Set(['text', 'mediumtext', 'longtext']);
const approximate = new Set(['real', 'float', 'double']);
const jsonTypes = new Set(['json', 'jsonb', 'array', 'object']);

export function fieldKind(declaration, dialect) {
  const lower = declaration.toLowerCase();
  if (lower.endsWith('[]')) return { kind: 'json', hint: 'JSON array' };
  const [type] = lower.split(/[(\[]/);
  const [size, scale] = (lower.match(/\((\d+)(?:,(\d+))?\)/)?.slice(1) ?? []).map(Number);
  const mongo = dialect === 'mongodb';
  if (integers.has(type)) return { kind: 'number', step: '1', integer: true };
  if (type === 'decimal' || type === 'numeric') {
    return { kind: 'number', step: scale ? '0.' + '0'.repeat(scale - 1) + '1' : '1', integer: !scale };
  }
  if (approximate.has(type)) return { kind: 'number', step: 'any' };
  if (type === 'boolean' || type === 'bool')
    return { kind: 'boolean', native: dialect === 'postgresql' || mongo ? ['true', 'false'] : ['1', '0'] };
  if (type === 'date') return mongo ? { kind: 'datetime', zone: 'T' } : { kind: 'date' };
  if (type === 'time')
    return dialect === 'mysql' ? { kind: 'text', hint: 'HH:MM:SS (up to 838 hours)' } : { kind: 'time' };
  if (type === 'timestamp' && mongo) return { kind: 'json', hint: 'Object with t and i' };
  if (type === 'timestamptz') return { kind: 'datetime', zone: ' ' };
  if (type === 'timestamp' || type === 'datetime') return { kind: 'datetime' };
  if (jsonTypes.has(type))
    return { kind: 'json', hint: type === 'array' ? 'JSON array' : type === 'object' ? 'JSON object' : 'JSON' };
  if (type === 'uuid') return { kind: 'text', generate: 'uuid', hint: 'UUID' };
  if (type === 'objectid') return { kind: 'text', generate: 'objectid', hint: '24 hex characters' };
  if (longText.has(type)) return { kind: 'textarea' };
  if (type === 'varchar' || type === 'char' || type === 'string') {
    return size > 255 ? { kind: 'textarea', maxLength: size } : { kind: 'text', maxLength: size || undefined };
  }
  if (type === 'blob' || type === 'bytea' || type === 'binary' || type === 'varbinary')
    return { kind: 'text', hint: 'Hex bytes, e.g. 0A1B', mono: true };
  if (type === 'inet') return { kind: 'text', hint: '192.168.0.1 or 192.168.0.0/24', mono: true };
  if (type === 'interval') return { kind: 'text', hint: 'ISO 8601, e.g. P2D or PT30M', mono: true };
  return { kind: 'text' };
}

const withSeconds = time => (/^\d{2}:\d{2}$/.test(time) ? time + ':00' : time);

// Stored text -> value for the native input. Anything the input cannot show is left blank rather than guessed.
export function toInputValue(config, value) {
  if (value === '') return '';
  if (config.kind === 'time') return /^\d{2}:\d{2}(?::\d{2})?$/.test(value) ? value : '';
  if (config.kind === 'datetime') {
    const parts = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i);
    if (!parts) return '';
    if (config.zone && parts[3] && parts[3].toUpperCase() !== 'Z') {
      const instant = new Date(parts[1] + 'T' + withSeconds(parts[2]) + parts[3]);
      return Number.isFinite(instant.getTime()) ? instant.toISOString().slice(0, 19) : '';
    }
    return parts[1] + 'T' + withSeconds(parts[2]);
  }
  return value;
}

// Value from the native input -> the text the draft stores (and the validator accepts).
export function fromInputValue(config, value) {
  if (value === '') return '';
  if (config.kind === 'time') return withSeconds(value);
  if (config.kind === 'datetime') {
    const [day, time] = value.split('T');
    const stamp = day + (config.zone === 'T' ? 'T' : ' ') + withSeconds(time);
    return config.zone ? stamp + 'Z' : stamp;
  }
  return value;
}

export function generateValue(kind) {
  if (kind === 'uuid') return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
