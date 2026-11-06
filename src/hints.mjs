import { fieldTypes, mysqlCollations } from './schema.mjs';

export function getHints(source, cursor, dialect) {
  const lineStart = source.slice(0, cursor).lastIndexOf('\n') + 1;
  const before = source.slice(lineStart, cursor);
  const token = before.match(/[a-z_0-9]*$/i)[0];
  const start = cursor - token.length;
  const end = cursor + source.slice(cursor).match(/^[a-z_0-9]*/i)[0].length;
  const words = before
    .slice(0, before.length - token.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const mongo = dialect === 'mongodb';
  const entityKeyword = mongo ? 'collection' : 'table';
  const context = source
    .slice(0, lineStart)
    .split('\n')
    .map(line => line.trim());
  const previousBoundary = context.findLast(
    line => line === '}' || new RegExp('^' + entityKeyword + '\\s+\\w+\\s+\\{$').test(line)
  );
  const inside = Boolean(previousBoundary && previousBoundary !== '}');
  let options = [];

  if (!/^\s*(?:#|\/\/)/.test(before) && /(?:^|\s)[a-z_0-9]*$/i.test(before)) {
    if (!inside && words.length === 0) {
      options = context.some(line => /^database\s+/.test(line)) ? [entityKeyword] : ['database'];
    } else if (!inside && words[0] === 'database' && dialect === 'mysql') {
      if (words.length === 2) options = ['charset'];
      if (words.length === 3 && words[2] === 'charset') options = Object.keys(mysqlCollations);
      const charset = words[3]?.toLowerCase();
      if (Object.hasOwn(mysqlCollations, charset) && words[2] === 'charset') {
        if (words.length === 4) options = ['collate'];
        if (words.length === 5 && words[4] === 'collate') options = mysqlCollations[charset];
      }
    } else if (inside && words.length === 0) {
      options = mongo ? ['index'] : ['index', 'primary'];
    } else if (inside && words[0] === 'index' && words.length === 1) {
      options = ['unique'];
    } else if (inside && !['index', 'primary'].includes(words[0]) && words.length === 1) {
      options = fieldTypes[dialect];
    } else if (inside && !mongo && words.at(-1) === 'ondelete') {
      options = ['cascade', 'restrict', 'set_null', 'no_action'];
    } else if (inside && !mongo && words.at(-1) === 'default') {
      options = ['now', 'true', 'false', 'null'];
    } else if (
      inside &&
      /^[a-z]+(?:\(\d+(?:,\d+)?\))?(?:\[\])?$/i.test(words[1] ?? '') &&
      !['index', 'primary'].includes(words[0]) &&
      words.at(-1) !== 'ref'
    ) {
      options = [
        'pk',
        'required',
        'unique',
        'ref',
        ...(mongo ? [] : ['default', ...(words.includes('ref') ? ['ondelete'] : [])]),
      ].filter(option => !words.slice(2).includes(option) && (option !== 'pk' || !mongo || words[0] === '_id'));
    }
  }
  return { start, end, items: options.filter(option => option.toLowerCase().startsWith(token.toLowerCase())) };
}
