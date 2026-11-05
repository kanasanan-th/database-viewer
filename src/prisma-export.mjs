import { compile } from './schema.mjs';

const mappings = {
  postgresql: {
    smallint: 'Int SmallInt', integer: 'Int', int: 'Int', bigint: 'BigInt', serial: 'Int', bigserial: 'BigInt',
    boolean: 'Boolean', bool: 'Boolean', text: 'String', varchar: 'String VarChar', char: 'String Char',
    numeric: 'Decimal Decimal', decimal: 'Decimal Decimal', real: 'Float Real', float: 'Float', double: 'Float',
    uuid: 'String Uuid', json: 'Json Json', jsonb: 'Json', date: 'DateTime Date', time: 'DateTime Time(6)',
    timestamp: 'DateTime Timestamp(6)', timestamptz: 'DateTime Timestamptz(6)', bytea: 'Bytes', inet: 'String Inet',
    interval: 'Unsupported("interval")',
  },
  mysql: {
    tinyint: 'Int TinyInt', smallint: 'Int SmallInt', mediumint: 'Int MediumInt', int: 'Int', integer: 'Int',
    bigint: 'BigInt', boolean: 'Boolean', bool: 'Boolean', text: 'String Text', tinytext: 'String TinyText',
    mediumtext: 'String MediumText', longtext: 'String LongText', varchar: 'String VarChar', char: 'String Char',
    decimal: 'Decimal Decimal', numeric: 'Decimal Decimal', float: 'Float Float', double: 'Float', json: 'Json',
    date: 'DateTime Date', time: 'DateTime Time(0)', datetime: 'DateTime DateTime(0)',
    timestamp: 'DateTime Timestamp(0)', blob: 'Bytes Blob', binary: 'Bytes Binary', varbinary: 'Bytes VarBinary',
  },
  sqlite: {
    integer: 'Int', int: 'Int', bigint: 'BigInt', smallint: 'Int', text: 'String', varchar: 'String', char: 'String',
    real: 'Float', double: 'Float', float: 'Float', numeric: 'Decimal', decimal: 'Decimal', boolean: 'Boolean',
    blob: 'Bytes', date: 'DateTime', datetime: 'DateTime', timestamp: 'DateTime',
  },
  mongodb: {
    objectId: 'String ObjectId', string: 'String', bool: 'Boolean', int: 'Int', long: 'BigInt', double: 'Float',
    date: 'DateTime Date', timestamp: 'DateTime Timestamp', object: 'Json', array: 'Json', binData: 'Bytes',
  },
};

const reservedModelNames = new Set([
  'model', 'enum', 'type', 'view', 'datasource', 'generator', 'prisma', 'prismaclient',
  'string', 'int', 'bigint', 'float', 'decimal', 'boolean', 'datetime', 'json', 'bytes', 'unsupported',
  'null', 'true', 'false', 'undefined', 'object', 'function', 'class', 'default', 'delete', 'new', 'constructor',
]);
const deleteActions = { CASCADE: 'Cascade', RESTRICT: 'Restrict', 'SET NULL': 'SetNull' };
const uniqueKey = (entity, name) => entity.primary.length === 1 && entity.primary[0] === name ||
  entity.fields.some(field => field.name === name && field.unique) ||
  entity.indexes.some(index => index.unique && index.columns.length === 1 && index.columns[0] === name);
const requiredField = (entity, field) => field.required || entity.primary.includes(field.name);

function defaultAttribute(field, base, scalar, list) {
  if (!field.default) return ['serial', 'bigserial'].includes(base) ? '@default(autoincrement())' : '';
  const { kind, value } = field.default;
  if (value === null) return '';
  if (!list && kind === 'now' && scalar === 'DateTime') return '@default(now())';
  if (!list && kind === 'literal') {
    if (scalar === 'Boolean') {
      const literal = String(value).trim().toLowerCase();
      if (literal === 'false' || literal === '0') return '@default(false)';
      if (literal === 'true' || literal === '1') return '@default(true)';
      throw new Error('Prisma export: Boolean default on field ' + field.name + ' must be true, false, 1, or 0.');
    }
    if (scalar === 'String' && typeof value === 'string' ||
        ['Int', 'BigInt'].includes(scalar) && Number.isSafeInteger(value) ||
        ['Float', 'Decimal'].includes(scalar) && typeof value === 'number') {
      return '@default(' + JSON.stringify(value) + ')';
    }
  }
  throw new Error('Prisma export: unsupported default on field ' + field.name + '.');
}

function fieldType(field, dialect) {
  const [, type, args, list] = field.type.match(/^([a-z]+)(?:\(([^)]+)\))?(\[\])?$/i);
  const base = dialect === 'mongodb' ? type : type.toLowerCase();
  const mapping = mappings[dialect][base];
  if (!mapping) throw new Error('Prisma export: unsupported type ' + type + ' on field ' + field.name + '.');
  let [scalar, native] = mapping.split(' ');
  if (native === 'Decimal' && (args || dialect === 'mysql')) {
    const precision = args ?? '10,0';
    native += '(' + (precision.includes(',') ? precision : precision + ',0') + ')';
  } else if (native === 'Char' || native === 'Binary' || args && native) {
    native += '(' + (args ?? '1') + ')';
  }
  return { base, scalar, native, list };
}

export function exportPrisma(source, dialect) {
  const { schema } = compile(source, dialect);
  const mongo = dialect === 'mongodb';
  const models = new Map(schema.entities.map(entity => {
    const fields = new Map();
    const names = new Set(entity.fields.filter(field => !field.name.startsWith('_')).map(field => field.name));
    const allocate = stem => {
      let name = stem;
      for (let i = 2; names.has(name); i++) name = stem + '_' + i;
      names.add(name);
      return name;
    };
    for (const field of entity.fields) {
      const name = field.name.startsWith('_') ? allocate(field.name === '_id' ? 'id' : 'field' + field.name) : field.name;
      fields.set(field.name, { ...fieldType(field, dialect), name });
    }
    // Keep the Syntax name; only a name Prisma reserves gets a prefix (and @@map restores the real name).
    const name = reservedModelNames.has(entity.name.toLowerCase()) ? 'Db_' + entity.name : entity.name;
    return [entity.name, { entity, name, fields, allocate, relations: [] }];
  }));

  for (const model of models.values()) {
    const { entity, fields } = model;
    if (mongo && !fields.has('_id')) throw new Error('Prisma export: declare _id in ' + entity.name + '.');
    if (!mongo && !entity.primary.length &&
        !entity.fields.some(field => field.required && field.unique) &&
        !entity.indexes.some(index => index.unique &&
          index.columns.every(column => entity.fields.find(field => field.name === column).required))) {
      throw new Error('Prisma export: ' + entity.name + ' needs a primary key or a required unique key.');
    }
    for (const field of entity.fields) {
      if (!field.ref) continue;
      const target = models.get(field.ref.entity);
      const from = fields.get(field.name);
      const to = target.fields.get(field.ref.field);
      if (from.list || to.list || from.scalar !== to.scalar || from.scalar.startsWith('Unsupported') ||
          mongo && (from.native !== to.native || field.ref.field !== '_id' && !uniqueKey(target.entity, field.ref.field))) {
        throw new Error('Prisma export: incompatible relation on ' + entity.name + '.' + field.name + '.');
      }
      const relation = JSON.stringify(entity.name + '.' + field.name);
      const required = requiredField(entity, field);
      const inverse = uniqueKey(entity, field.name) || mongo && field.name === '_id' ? '?' : '[]';
      model.relations.push('  ' + model.allocate(target.entity.name) + ' ' + target.name +
        (required ? '' : '?') + ' @relation(' + relation + ', fields: [' + from.name + '], references: [' + to.name +
        '], onDelete: ' + (deleteActions[field.ondelete] ?? 'NoAction') + ', onUpdate: NoAction)');
      target.relations.push('  ' + target.allocate(entity.name) + ' ' +
        model.name + inverse + ' @relation(' + relation + ')');
    }
  }

  const blocks = [
    '// Schema Studio database: ' + schema.database,
    '// Preview seed rows are exported separately using SQL or mongosh.',
    ...(mongo ? ['// Prisma ORM 6.19. Set DATABASE_URL in your environment.'] :
      ['// Prisma ORM 7. Configure the connection URL in prisma.config.ts.']),
    ...(schema.databaseOptions ? ['// Set database charset/collation separately: ' +
      Object.values(schema.databaseOptions).join(' / ')] : []),
    ...(dialect === 'sqlite' ? ['// SQLite types are mapped to Prisma scalars without native type annotations.'] : []),
    ...(mongo ? ['// BSON objects and arrays use Prisma Json.'] : []),
    '',
    'datasource db {\n  provider = ' + JSON.stringify(dialect) + (mongo ? '\n  url = env("DATABASE_URL")' : '') + '\n}',
  ];
  for (const { entity, name, fields, relations } of models.values()) {
    const lines = entity.fields.map(field => {
      const { scalar, base, native, name: fieldName, list } = fields.get(field.name);
      const id = mongo ? field.name === '_id' : entity.primary.length === 1 && entity.primary[0] === field.name;
      if (mongo && id && !['String', 'Int', 'BigInt'].includes(scalar)) {
        throw new Error('Prisma export: unsupported _id type on ' + entity.name + '.');
      }
      const required = id || requiredField(entity, field);
      const attributes = [
        id && '@id',
        field.unique && !id && '@unique',
        mongo && id && native === 'ObjectId' ? '@default(auto())' : defaultAttribute(field, base, scalar, list),
        fieldName !== field.name && '@map(' + JSON.stringify(field.name) + ')',
        native && '@db.' + native,
      ].filter(Boolean);
      const definition = ['  ' + fieldName, scalar + (list ? '[]' : required ? '' : '?'), ...attributes].join(' ');
      return list && !required ? '  // Prisma scalar lists cannot be nullable.\n' + definition : definition;
    });
    lines.push(...relations);
    const columns = names => names.map(column => fields.get(column).name).join(', ');
    if (entity.primary.length > 1) lines.push('  @@id([' + columns(entity.primary) + '])');
    for (const index of entity.indexes) {
      lines.push('  @@' + (index.unique ? 'unique' : 'index') + '([' + columns(index.columns) +
        '], map: ' + JSON.stringify(index.name) + ')');
    }
    if (name !== entity.name) lines.push('  @@map(' + JSON.stringify(entity.name) + ')');
    blocks.push('', 'model ' + name + ' {\n' + lines.join('\n') + '\n}');
  }
  return { schema, script: blocks.join('\n') + '\n', extension: 'prisma' };
}
