import { pickedCompletion, snippetCompletion } from '@codemirror/autocomplete';
import { getHints } from './hints.mjs';

// Draft syntax (used by the main source editor and by "Compare" inputs).
export function completeSchema(dialect) {
  return context => {
    const source = context.state.doc.toString();
    const { start, end, items } = getHints(source, context.pos, dialect);
    if (!items.length) return null;
    return {
      from: start,
      to: end,
      filter: false,
      options: items.map(label => ({
        label,
        apply(view, completion, from, to) {
          const next = view.state.doc.sliceString(to, to + 1);
          const hasArguments = next === '(' || next === '[';
          const needsSize = !hasArguments && dialect === 'mysql';
          const size = needsSize && label === 'varchar' ? '(255)' : needsSize && label === 'varbinary' ? '(32)' : '';
          const hasSpace = /[ \t]/.test(next);
          const insert = label + size + (hasSpace || hasArguments ? '' : ' ');
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length + Number(hasSpace) },
            annotations: pickedCompletion.of(completion),
            userEvent: 'input.complete',
            scrollIntoView: true,
          });
        },
      })),
    };
  };
}

const keyword = (label, detail) => ({ label, type: 'keyword', detail });
const word = (label, type = 'keyword') => ({ label, type });

const sqlKeywords = [
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'AS',
  'IN',
  'IS',
  'LIKE',
  'BETWEEN',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'ON',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'DISTINCT',
  'UNION',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'PRIMARY KEY',
  'FOREIGN KEY',
  'REFERENCES',
  'UNIQUE',
  'DEFAULT',
  'NOT NULL',
  'ON DELETE CASCADE',
  'CREATE INDEX',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'ASC',
  'DESC',
  'EXISTS',
].map(label => word(label));
const sqlTypes = [
  'integer',
  'bigint',
  'smallint',
  'serial',
  'boolean',
  'text',
  'varchar(255)',
  'char(1)',
  'numeric(12,2)',
  'real',
  'double',
  'uuid',
  'json',
  'jsonb',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'datetime',
  'blob',
].map(label => word(label, 'type'));
const sqlSnippets = [
  snippetCompletion('SELECT ${columns}\nFROM ${table}\nWHERE ${condition};', {
    label: 'select…',
    detail: 'query',
    type: 'text',
  }),
  snippetCompletion('CREATE TABLE ${name} (\n  id integer PRIMARY KEY,\n  ${column} text NOT NULL\n);', {
    label: 'create table…',
    detail: 'statement',
    type: 'text',
  }),
  snippetCompletion('INSERT INTO ${table} (${columns})\nVALUES (${values});', {
    label: 'insert…',
    detail: 'statement',
    type: 'text',
  }),
  snippetCompletion('UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition};', {
    label: 'update…',
    detail: 'statement',
    type: 'text',
  }),
  snippetCompletion('SELECT ${a}.*, ${b}.*\nFROM ${tableA} ${a}\nJOIN ${tableB} ${b} ON ${b}.${fk} = ${a}.id;', {
    label: 'join…',
    detail: 'query',
    type: 'text',
  }),
];

const dbmlKeywords = [
  'Table',
  'Ref',
  'Enum',
  'Project',
  'indexes',
  'Note',
  'TableGroup',
  'pk',
  'primary key',
  'unique',
  'not null',
  'null',
  'increment',
  'default: ',
  'ref: > ',
  'ref: < ',
  'ref: - ',
  'note: ',
].map(label => word(label));
const dbmlSnippets = [
  snippetCompletion('Table ${name} {\n  id integer [pk, increment]\n  ${column} varchar [not null]\n}', {
    label: 'Table…',
    detail: 'definition',
    type: 'text',
  }),
  snippetCompletion('Ref: ${table}.${column} > ${other}.id', { label: 'Ref…', detail: 'relationship', type: 'text' }),
  snippetCompletion('Enum ${name} {\n  ${value}\n}', { label: 'Enum…', detail: 'definition', type: 'text' }),
];

const jsonSnippets = [
  snippetCompletion('{\n  "${key}": ${value}\n}', { label: 'object', detail: '{ }', type: 'text' }),
  snippetCompletion('[\n  ${item}\n]', { label: 'array', detail: '[ ]', type: 'text' }),
];
const jsonValues = ['true', 'false', 'null'].map(label => word(label, 'constant'));

// Keys and operations of the draft-edit proposal JSON that agents return and people paste for review.
const proposalKeys = [
  'kind',
  'version',
  'base',
  'dialect',
  'source',
  'preview',
  'operations',
  'changes',
  'op',
  'entity',
  'rows',
  'name',
  'fields',
  'declaration',
].map(label => ({ label: '"' + label + '"', type: 'property' }));
const proposalValues = [
  'schema-studio-draft-edits',
  'append_rows',
  'replace_rows',
  'replace_source',
  'format_source',
  'add_entity',
  'add_field',
  'clear_preview',
].map(label => ({ label: '"' + label + '"', type: 'enum' }));

const sources = {
  sql: [...sqlSnippets, ...sqlKeywords, ...sqlTypes],
  dbml: [
    ...dbmlSnippets,
    ...dbmlKeywords,
    ...sqlTypes.map(item => ({ ...item, label: item.label.replace(/\(.*\)/, '') })),
  ],
  json: [...jsonSnippets, ...jsonValues],
  proposal: [...jsonSnippets, ...proposalKeys, ...proposalValues, ...jsonValues],
};

function listSource(options, pattern) {
  return context => {
    const match = context.matchBefore(pattern);
    if (!match || (match.from === match.to && !context.explicit)) return null;
    return { from: match.from, options, validFor: pattern };
  };
}

// Returns a CodeMirror completion source for a language, or null when it has none.
// `names` are table and column names from the open draft, offered while writing SQL.
export function completionSource(language, { dialect, names = [], proposal = false } = {}) {
  if (language === 'schema') return completeSchema(dialect);
  if (language === 'sql') {
    const known = names.map(label => word(label, 'variable'));
    return listSource([...known, ...sources.sql], /[\w$]*/);
  }
  if (language === 'dbml') return listSource(sources.dbml, /[\w:>< ]*/);
  if (language === 'json') return listSource(proposal ? sources.proposal : sources.json, /"?[\w-]*/);
  return null;
}

export const codeTips = {
  sql: 'Statements end with ;  ·  Ctrl+Space for keywords, types and your table names',
  dbml: 'Table name { column type [pk, not null] }  ·  Ref: a.b > c.d for relations',
  json: 'Double quotes for keys and strings  ·  no trailing commas',
  schema: 'database NAME, then table NAME { column type [required] [pk] }',
};

export const codeExamples = {
  import:
    'CREATE TABLE customers (\n  id integer PRIMARY KEY,\n  email varchar(255) NOT NULL UNIQUE\n);\n\nCREATE TABLE orders (\n  id integer PRIMARY KEY,\n  customer_id integer NOT NULL REFERENCES customers (id)\n);\n',
  dbml: 'Table customers {\n  id integer [pk, increment]\n  email varchar(255) [not null, unique]\n}\n\nTable orders {\n  id integer [pk, increment]\n  customer_id integer [not null]\n}\n\nRef: orders.customer_id > customers.id\n',
  proposal:
    '{\n  "kind": "schema-studio-draft-edits",\n  "version": 1,\n  "operations": [\n    { "op": "format_source" }\n  ]\n}\n',
};
