// Draws the entity diagram as a standalone SVG, using the same box size and arrangement as the app.
export const box = { width: 294, header: 47, row: 35, index: 28 };
const escape = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const height = entity => box.header + entity.fields.length * box.row + (entity.indexes.length ? box.index : 0);

export function erdSvg(schema, positions) {
  const at = name => positions[name] ?? { x: 0, y: 0 };
  const rowY = (entity, fieldName) => {
    const index = Math.max(0, entity.fields.findIndex(field => field.name === fieldName));
    return at(entity.name).y + box.header + index * box.row + box.row / 2;
  };
  const byName = new Map(schema.entities.map(entity => [entity.name, entity]));
  const xs = schema.entities.flatMap(entity => [at(entity.name).x, at(entity.name).x + box.width]);
  const ys = schema.entities.flatMap(entity => [at(entity.name).y, at(entity.name).y + height(entity)]);
  const pad = 48;
  const left = (xs.length ? Math.min(...xs) : 0) - pad;
  const top = (ys.length ? Math.min(...ys) : 0) - pad;
  const width = (xs.length ? Math.max(...xs) : 0) + pad - left;
  const bottom = (ys.length ? Math.max(...ys) : 0) + pad - top;
  const edges = schema.entities.flatMap(entity => entity.fields.filter(field => field.ref).map(field => {
    const target = byName.get(field.ref.entity);
    const toLeft = at(entity.name).x > at(target.name).x;
    const x1 = at(entity.name).x + (toLeft ? 0 : box.width);
    const x2 = at(target.name).x + (toLeft ? box.width : 0);
    const bend = toLeft ? -70 : 70;
    const y1 = rowY(entity, field.name);
    const y2 = rowY(target, field.ref.field);
    return '<path d="M' + x1 + ' ' + y1 + ' C' + (x1 + bend) + ' ' + y1 + ' ' + (x2 - bend) + ' ' + y2 + ' ' + x2 + ' ' + y2 +
      '" fill="none" stroke="#177456" stroke-width="1.7" stroke-dasharray="6 5"><title>' + escape(entity.name + '.' + field.name + ' → ' + field.ref.entity + '.' + field.ref.field) + '</title></path>';
  }));
  const cards = schema.entities.map(entity => {
    const { x, y } = at(entity.name);
    const rows = entity.fields.map((field, index) => {
      const flag = entity.primary.includes(field.name) ? ' PK' : field.required ? ' REQ' : '';
      const base = y + box.header + index * box.row;
      return '<line x1="' + x + '" x2="' + (x + box.width) + '" y1="' + base + '" y2="' + base + '" stroke="#dbe5e3"/>' +
        '<text x="' + (x + 15) + '" y="' + (base + 22) + '" font-size="13" fill="#17312c">' + escape(field.name) + '</text>' +
        '<text x="' + (x + box.width - 15) + '" y="' + (base + 22) + '" font-size="13" text-anchor="end" fill="#5c716c">' + escape(field.type + flag) + '</text>';
    }).join('');
    const footer = entity.indexes.length
      ? '<text x="' + (x + 15) + '" y="' + (y + height(entity) - 9) + '" font-size="11" fill="#5c716c">' + entity.indexes.length + (entity.indexes.length === 1 ? ' index' : ' indexes') + '</text>' : '';
    return '<g><rect x="' + x + '" y="' + y + '" width="' + box.width + '" height="' + height(entity) + '" rx="9" fill="#fff" stroke="#a9bcb8"/>' +
      '<text x="' + (x + 16) + '" y="' + (y + 30) + '" font-size="18" font-weight="700" fill="#17312c">' + escape(entity.name) + '</text>' + rows + footer + '</g>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + bottom + '" viewBox="' + left + ' ' + top + ' ' + width + ' ' + bottom + '" font-family="ui-monospace, Menlo, Consolas, monospace">\n' +
    '<title>' + escape(schema.database) + ' — entity diagram</title>\n<rect x="' + left + '" y="' + top + '" width="' + width + '" height="' + bottom + '" fill="#f4f9f6"/>\n' +
    [...edges, ...cards].join('\n') + '\n</svg>\n';
}
