import { compile, dialects } from './schema.mjs';

const identifier = /^[a-z_]\w{0,62}$/i;
const tokenPattern =
  /--[^\r\n]*|\/\*[\s\S]*?\*\/|\\connect[^\r\n]*|[Ee]'(?:''|\\.|[^'])*'|'(?:''|[^'])*'|"[^"]*"|`[^`]*`|\[[a-z_]\w*\]|\[\]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z_]\w*|[(),;=]|\S/gi;

function sqlName(token, dialect) {
  const result = token?.replace(/^(?:"|`|\[)|(?:"|`|\])$/g, '');
  if (!identifier.test(result ?? '')) throw new Error('Unsupported SQL identifier ' + (token ?? '(missing)'));
  return dialect === 'postgresql' && token === result ? result.toLowerCase() : result;
}

function readDefault(token, dialect) {
  if (/^current_timestamp$/i.test(token)) return 'now';
  if (/^(?:E)?'/i.test(token)) {
    let value = token.slice(token[0] === "'" ? 1 : 2, -1).replaceAll("''", "'");
    if (/^E'/i.test(token) || dialect === 'mysql') {
      if (/\\(?!\\)/.test(value.replaceAll('\\\\', ''))) throw new Error('Unsupported escape in SQL default.');
      value = value.replaceAll('\\\\', '\\');
    }
    return JSON.stringify(value);
  }
  if (/^(null|true|false)$/i.test(token)) return token.toLowerCase();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token) && Number.isFinite(Number(token))) {
    if (/^[+-]?\d+$/.test(token) && !Number.isSafeInteger(Number(token)))
      throw new Error('Integer default exceeds draft precision.');
    return JSON.stringify(Number(token));
  }
  throw new Error('Unsupported SQL default ' + (token ?? '(missing)'));
}

function reader(tokens) {
  let at = 0;
  const peek = () => tokens[at]?.toUpperCase();
  const take = () => tokens[at++];
  const accept = word => peek() === word && Boolean(take());
  function expect(word) {
    if (!accept(word)) throw new Error('Expected ' + word + ', found ' + (tokens[at] ?? 'end of statement'));
  }
  function list(read) {
    expect('(');
    const values = [read()];
    while (accept(',')) values.push(read());
    expect(')');
    return values;
  }
  return { peek, take, accept, expect, list };
}

export function importSql(text, dialect, fallback = 'imported') {
  if (!Object.hasOwn(dialects, dialect) || dialect === 'mongodb')
    throw new Error('Choose a SQL engine before importing.');
  if (typeof text !== 'string' || text.length > 700_000) throw new Error('SQL input exceeds the import limit.');
  const name = token => sqlName(token, dialect);
  const chunks = [[]];
  const pattern =
    dialect === 'mysql'
      ? new RegExp(tokenPattern.source.replace("'(?:''|[^'])*'", "'(?:''|\\\\.|[^'\\\\])*'"), 'gi')
      : tokenPattern;
  for (const token of text.match(pattern) ?? []) {
    if (/^(?:--|\/\*)/.test(token)) continue;
    if (/^\\connect\b/i.test(token)) {
      if (dialect !== 'postgresql' || chunks.at(-1).length) throw new Error('Unexpected database connection command.');
      chunks.at(-1).push('USE', token.slice(8).trim());
      chunks.push([]);
      continue;
    }
    if (token === ';') chunks.push([]);
    else chunks.at(-1).push(token);
  }
  let database;
  let charset;
  let collation;
  const tables = new Map();
  const indexes = [];
  const refs = [];
  for (const [offset, tokens] of chunks.entries()) {
    if (!tokens.length) continue;
    const { peek, take, accept, expect, list } = reader(tokens);
    const names = () => list(() => name(take()));
    const ifNotExists = () => {
      if (accept('IF')) {
        expect('NOT');
        expect('EXISTS');
      }
    };
    function reference() {
      const table = name(take());
      const columns = names();
      if (columns.length !== 1) throw new Error('Only single-column references can be imported.');
      let suffix = ' ref ' + table + '.' + columns[0];
      if (accept('ON')) {
        expect('DELETE');
        const action = take()?.toUpperCase();
        if (action === 'SET') expect('NULL');
        else if (action === 'NO') expect('ACTION');
        else if (action !== 'CASCADE' && action !== 'RESTRICT') throw new Error('Unsupported ON DELETE action.');
        suffix += ' ondelete ' + ({ SET: 'set_null', NO: 'no_action' }[action] ?? action.toLowerCase());
      }
      return suffix;
    }
    function foreign(table) {
      expect('KEY');
      const fields = names();
      if (fields.length !== 1) throw new Error('Only single-column references can be imported.');
      expect('REFERENCES');
      refs.push({ table, field: fields[0], suffix: reference() });
    }
    function databaseName(value) {
      if (database && database !== value) throw new Error('Import one database at a time.');
      database = value;
    }
    try {
      if (accept('CREATE')) {
        if (accept('DATABASE')) {
          ifNotExists();
          databaseName(name(take()));
          if (peek()) {
            accept('DEFAULT');
            expect('CHARACTER');
            expect('SET');
            accept('=');
            charset = name(take());
            if (accept('COLLATE')) {
              accept('=');
              collation = name(take());
            }
          }
        } else if (accept('TABLE')) {
          ifNotExists();
          const table = name(take());
          if (tables.has(table)) throw new Error('Duplicate table ' + table);
          const fields = new Map();
          const primary = [];
          list(() => {
            let constraint;
            if (accept('CONSTRAINT')) constraint = name(take());
            if (accept('PRIMARY')) {
              expect('KEY');
              primary.push(...names());
              return;
            }
            if (accept('FOREIGN')) {
              foreign(table);
              return;
            }
            if (accept('UNIQUE')) {
              const columns = names();
              indexes.push({
                table,
                index: constraint ?? table + '_unique_' + (indexes.length + 1),
                unique: true,
                columns,
              });
              return;
            }
            if (constraint) throw new Error('Unsupported table constraint.');
            const field = name(take());
            if (fields.has(field)) throw new Error('Duplicate column ' + field);
            let type = name(take()).toLowerCase();
            if (type === 'double') accept('PRECISION');
            if (type === 'character' && accept('VARYING')) type = 'varchar';
            if (peek() === '(')
              type +=
                '(' +
                list(() => {
                  const value = take();
                  if (!/^\d+$/.test(value ?? '')) throw new Error('Expected a numeric type parameter.');
                  return value;
                }).join(',') +
                ')';
            if (accept('[]')) type += '[]';
            let suffix = '';
            while (peek() && ![',', ')'].includes(peek())) {
              if (accept('NOT')) {
                expect('NULL');
                suffix += ' required';
              } else if (accept('NULL')) continue;
              else if (accept('PRIMARY')) {
                expect('KEY');
                primary.push(field);
              } else if (accept('UNIQUE')) suffix += ' unique';
              else if (accept('DEFAULT')) suffix += ' default ' + readDefault(take(), dialect);
              else if (accept('REFERENCES')) suffix += reference();
              else throw new Error('Unsupported column clause ' + peek());
            }
            fields.set(field, field + ' ' + type + suffix);
          });
          if (accept('ENGINE')) {
            expect('=');
            expect('INNODB');
          }
          tables.set(table, { fields, primary });
        } else {
          const unique = accept('UNIQUE');
          expect('INDEX');
          ifNotExists();
          const index = name(take());
          expect('ON');
          indexes.push({ index, unique, table: name(take()), columns: names() });
        }
      } else if (accept('ALTER')) {
        expect('TABLE');
        const table = name(take());
        expect('ADD');
        if (accept('CONSTRAINT')) name(take());
        expect('FOREIGN');
        foreign(table);
      } else if (accept('USE')) databaseName(name(take()));
      else if (dialect === 'sqlite' && accept('PRAGMA')) {
        expect('FOREIGN_KEYS');
        expect('=');
        expect('ON');
      } else throw new Error('Unsupported SQL command ' + peek());
      if (peek()) throw new Error('Unsupported SQL clause ' + peek());
    } catch (error) {
      throw new Error('Statement ' + (offset + 1) + ' · ' + error.message);
    }
  }
  for (const { table, field, suffix } of refs) {
    const fields = tables.get(table)?.fields;
    if (!fields?.has(field)) throw new Error('Unknown foreign key column ' + table + '.' + field);
    fields.set(field, fields.get(field) + suffix);
  }
  for (const { table } of indexes) if (!tables.has(table)) throw new Error('Unknown index table ' + table);
  const options = charset ? ' charset ' + charset + (collation ? ' collate ' + collation : '') : '';
  const source =
    [
      'database ' + (database ?? name(fallback)) + options,
      ...[...tables].flatMap(([table, { fields, primary }]) => [
        '',
        'table ' + table + ' {',
        ...[...fields.values()].map(field => '  ' + field),
        ...(primary.length ? ['  primary (' + primary.join(', ') + ')'] : []),
        ...indexes
          .filter(index => index.table === table)
          .map(
            index => '  index ' + (index.unique ? 'unique ' : '') + index.index + ' (' + index.columns.join(', ') + ')'
          ),
        '}',
      ]),
    ].join('\n') + '\n';
  compile(source, dialect);
  return source;
}
