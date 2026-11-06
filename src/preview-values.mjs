const integerBits = {
  tinyint: 8,
  smallint: 16,
  mediumint: 24,
  integer: 32,
  int: 32,
  serial: 32,
  bigint: 64,
  bigserial: 64,
  long: 64,
};
const textTypes = new Set(['text', 'tinytext', 'mediumtext', 'longtext', 'varchar', 'char', 'string']);
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const time = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/;

function integer(value, bits) {
  if (!/^[+-]?\d+$/.test(value)) return false;
  const normalized = value.replace(/^([+-]?)0+(?=\d)/, '$1');
  if (normalized.length > 20) return false;
  const number = BigInt(normalized);
  const limit = 1n << BigInt(bits - 1);
  return number >= -limit && number < limit;
}

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateTime(value, zoneRequired) {
  const parts = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/i
  );
  return Boolean(parts && date(parts[1]) && time.test(parts[2]) && (!zoneRequired || parts[3]));
}

function validJson(value, predicate) {
  try {
    return predicate(JSON.parse(value));
  } catch {
    return false;
  }
}

function validArray(value, type, dialect) {
  const base = type.split('(')[0];
  const json = base === 'json' || base === 'jsonb';
  const expected =
    Object.hasOwn(integerBits, base) || ['decimal', 'numeric', 'real', 'float', 'double'].includes(base)
      ? 'number'
      : ['boolean', 'bool'].includes(base)
        ? 'boolean'
        : 'string';
  return validJson(value, function check(items) {
    return (
      Array.isArray(items) &&
      items.every(item => {
        if (item === null || json) return true;
        if (Array.isArray(item)) return check(item);
        return typeof item === expected && !validatePreviewValue(type, String(item), dialect, expected !== 'string');
      })
    );
  });
}

function networkAddress(value) {
  const [address, mask, ...extra] = value.split('/');
  const ipv6 = address.includes(':');
  if (extra.length || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) > (ipv6 ? 128 : 32)))) return false;
  if (!ipv6) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) && address.split('.').every(part => Number(part) < 256);
  if (!/^[\da-f:.]+$/i.test(address)) return false;
  try {
    return Boolean(new URL('http://[' + address + ']/').hostname);
  } catch {
    return false;
  }
}

export function validatePreviewValue(declaration, raw, dialect, required) {
  if (raw === '') return required ? 'This field is required.' : null;
  const [type] = declaration.toLowerCase().split(/[(\[]/);
  const [size, scale] = (declaration.match(/\((\d+)(?:,(\d+))?\)/)?.slice(1) ?? []).map(Number);
  const value = raw.trim();
  const mongo = dialect === 'mongodb';
  if (declaration.endsWith('[]')) {
    return validArray(value, declaration.slice(0, -2).toLowerCase(), dialect)
      ? null
      : 'Use a JSON array of ' + declaration.slice(0, -2) + ' values.';
  }
  if (textTypes.has(type)) {
    return size && [...raw].length > size ? 'Use at most ' + size + ' characters.' : null;
  }
  if (Object.hasOwn(integerBits, type)) {
    const bits = dialect === 'sqlite' ? 64 : integerBits[type];
    return integer(value, bits) ? null : 'Use a signed ' + bits + '-bit whole number.';
  }

  let valid;
  let hint;
  switch (type) {
    case 'decimal':
    case 'numeric': {
      const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
      const decimals = scale || 0;
      valid =
        decimal.test(value) &&
        (!size || (whole.replace(/^0+/, '').length <= size - decimals && fraction.length <= decimals));
      hint = size
        ? 'Use up to ' + (size - decimals) + ' digits before and ' + decimals + ' after the decimal point.'
        : 'Use a decimal number.';
      break;
    }
    case 'real':
    case 'float':
    case 'double':
      valid = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
      hint = 'Use a finite number.';
      break;
    case 'boolean':
    case 'bool':
      valid = (mongo || dialect === 'postgresql' ? /^(true|false)$/i : /^(true|false|0|1)$/i).test(value);
      hint = mongo || dialect === 'postgresql' ? 'Use true or false.' : 'Use true, false, 0 or 1.';
      break;
    case 'date':
      valid = mongo ? dateTime(value, true) : date(value);
      hint = mongo ? 'Use an ISO date and time with a time zone.' : 'Use a valid date in YYYY-MM-DD format.';
      break;
    case 'time':
      valid =
        dialect === 'mysql'
          ? /^-?\d{2,3}:[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(value) && Number(value.split(':')[0].replace('-', '')) <= 838
          : time.test(value);
      hint = 'Use a valid time in HH:MM:SS format.';
      break;
    case 'timestamp':
    case 'timestamptz':
    case 'datetime':
      valid = mongo
        ? validJson(
            value,
            item =>
              item && ['t', 'i'].every(key => Number.isInteger(item[key]) && item[key] >= 0 && item[key] <= 4294967295)
          )
        : dateTime(value, type === 'timestamptz');
      hint = mongo
        ? 'Use a JSON object with unsigned integer t and i fields.'
        : 'Use YYYY-MM-DD HH:MM:SS' + (type === 'timestamptz' ? ' with a time zone.' : '.');
      break;
    case 'json':
    case 'jsonb':
    case 'array':
    case 'object':
      valid = validJson(value, item =>
        type === 'array'
          ? Array.isArray(item)
          : type === 'object'
            ? item !== null && typeof item === 'object' && !Array.isArray(item)
            : true
      );
      hint = 'Use valid JSON' + (type === 'array' || type === 'object' ? ' for an ' + type : '') + '.';
      break;
    case 'uuid':
      valid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
      hint = 'Use a UUID.';
      break;
    case 'objectid':
      valid = /^[\da-f]{24}$/i.test(value);
      hint = 'Use a 24-digit hexadecimal ObjectId.';
      break;
    case 'blob':
    case 'bytea':
    case 'binary':
    case 'varbinary': {
      const hex = value.replace(/^(?:0x|\\x)/i, '');
      valid = /^(?:[\da-f]{2})+$/i.test(hex) && (!size || hex.length <= size * 2);
      hint = 'Use hexadecimal bytes' + (size ? ' (up to ' + size + ' bytes)' : '') + '.';
      break;
    }
    case 'bindata':
      valid = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value) && value.length > 0;
      hint = 'Use a Base64 value.';
      break;
    case 'inet':
      valid = networkAddress(value);
      hint = 'Use an IPv4 or IPv6 address, optionally with a subnet mask.';
      break;
    case 'interval':
      valid =
        /^[+-]?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/i.test(
          value
        );
      hint = 'Use an ISO 8601 duration such as P2D or PT30M.';
      break;
    case 'null':
      valid = value === 'null';
      hint = 'Use null.';
      break;
    case 'regex':
      try {
        new RegExp(value);
        valid = value.length > 0;
      } catch {
        valid = false;
      }
      hint = 'Use a valid JavaScript regular expression pattern.';
      break;
    default:
      return null;
  }
  return valid ? null : hint;
}
