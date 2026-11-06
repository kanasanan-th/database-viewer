// Design checks on a compiled schema. They never change the draft; they only describe what to look at.
const aliases = {
  int: 'integer',
  integer: 'integer',
  bool: 'boolean',
  boolean: 'boolean',
  decimal: 'numeric',
  numeric: 'numeric',
};
const baseType = type => {
  const base = type
    .toLowerCase()
    .replace(/\(.*\)/, '')
    .replace(/\[\]$/, '');
  return aliases[base] ?? base;
};
const style = name => (/[A-Z]/.test(name) ? 'camelCase' : name.includes('_') ? 'snake_case' : 'plain');

export function lintSchema(schema, dialect) {
  const issues = [];
  const add = (severity, entity, field, message) => issues.push({ severity, entity, field, message });
  const mongo = dialect === 'mongodb';
  const entities = new Map(schema.entities.map(entity => [entity.name, entity]));
  for (const entity of schema.entities) {
    if (!mongo && !entity.primary.length)
      add('warning', entity.name, null, 'No primary key. Rows cannot be identified reliably.');
    if (!entity.fields.length) add('warning', entity.name, null, 'No fields.');
    for (const field of entity.fields) {
      if (!field.ref || mongo) continue;
      const target = entities.get(field.ref.entity)?.fields.find(item => item.name === field.ref.field);
      if (target && baseType(target.type) !== baseType(field.type)) {
        add(
          'error',
          entity.name,
          field.name,
          field.type +
            ' does not match ' +
            field.ref.entity +
            '.' +
            field.ref.field +
            ' (' +
            target.type +
            '); the database may reject this foreign key.'
        );
      }
      const indexed =
        entity.primary[0] === field.name ||
        field.unique ||
        entity.indexes.some(index => index.columns[0] === field.name);
      if (!indexed)
        add(
          'info',
          entity.name,
          field.name,
          'Foreign key has no index. Joins and deletes on ' + field.ref.entity + ' may scan the whole table.'
        );
    }
  }
  const names = schema.entities
    .flatMap(entity => [entity.name, ...entity.fields.map(field => field.name)])
    .filter(name => !name.startsWith('_'));
  const groups = Object.groupBy(
    names.filter(name => style(name) !== 'plain'),
    style
  );
  const styles = Object.keys(groups);
  if (styles.length > 1) {
    const sample = list => [...new Set(list)].slice(0, 3).join(', ');
    add(
      'info',
      null,
      null,
      'Mixed naming styles: ' + styles.map(key => key + ' (' + sample(groups[key]) + ')').join(' and ') + '.'
    );
  }
  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
