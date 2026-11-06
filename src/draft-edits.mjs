import { z } from 'zod';
import { compile } from './schema.mjs';
import { compareSchemas } from './schema-compare.mjs';
import { maxDraftBytes, serializeDraft, validateDraft } from './draft.mjs';

const identifier = z.string().regex(/^[a-z_]\w{0,62}$/i);
const declaration = z
  .string()
  .min(1)
  .max(2000)
  .regex(/^[^\r\n{}]+$/);
const row = z.record(identifier, z.string().max(10_000));
export const appendRowsOperation = z.strictObject({
  op: z.literal('append_rows'),
  entity: identifier,
  rows: z.array(row).min(1).max(500),
});
export const draftOperations = z
  .array(
    z.discriminatedUnion('op', [
      z.strictObject({ op: z.literal('replace_source'), source: z.string().max(100_000) }),
      z.strictObject({ op: z.literal('format_source') }),
      z.strictObject({ op: z.literal('add_entity'), name: identifier, fields: z.array(declaration).min(1).max(200) }),
      z.strictObject({ op: z.literal('add_field'), entity: identifier, declaration }),
      appendRowsOperation,
      z.strictObject({ op: z.literal('replace_rows'), entity: identifier, rows: z.array(row).max(500) }),
      z.strictObject({ op: z.literal('clear_preview') }),
    ])
  )
  .min(1)
  .max(30);

const normalize = source => source.replace(/\r\n/g, '\n').trimEnd();

function indentSource(source) {
  let inside = false;
  return (
    normalize(source)
      .split('\n')
      .map(line => {
        const text = line.trim();
        if (!text) return '';
        if (text === '}') inside = false;
        const result = (inside ? '  ' : '') + text;
        if (/^(table|collection)\s+\w+\s+\{$/.test(text)) inside = true;
        return result;
      })
      .join('\n') + '\n'
  );
}

export function formatSchema(source, dialect) {
  compile(source, dialect);
  return indentSource(source);
}

function insertField(source, entity, declaration) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line.trim().match(/^(?:table|collection)\s+(\w+)\s+\{$/)?.[1] === entity);
  const end = lines.findIndex((line, index) => index > start && line.trim() === '}');
  if (start < 0 || end < 0) throw new Error('Unknown or incomplete entity ' + entity);
  lines.splice(end, 0, '  ' + declaration.trim());
  return lines.join('\n');
}

function applyOperations(draft, operations) {
  const { dialect } = draft;
  let source = draft.source;
  const preview = { ...draft.preview };
  const seedOperations = [];
  for (const operation of operations) {
    switch (operation.op) {
      case 'replace_source':
        source = operation.source;
        break;
      case 'format_source':
        source = indentSource(source);
        break;
      case 'add_entity': {
        const keyword = dialect === 'mongodb' ? 'collection' : 'table';
        source =
          normalize(source) +
          '\n\n' +
          keyword +
          ' ' +
          operation.name +
          ' {\n' +
          operation.fields.map(line => '  ' + line.trim()).join('\n') +
          '\n}\n';
        break;
      }
      case 'add_field':
        source = insertField(source, operation.entity, operation.declaration);
        break;
      default:
        seedOperations.push(operation);
        break;
    }
  }
  const { schema } = compile(source, dialect);
  const entities = new Map(
    schema.entities.map(entity => [entity.name, new Set(entity.fields.map(field => field.name))])
  );
  for (const { op, entity, rows } of seedOperations) {
    if (op === 'clear_preview') {
      for (const key of Object.keys(preview)) delete preview[key];
      continue;
    }
    const fields = entities.get(entity);
    if (!fields) throw new Error('Unknown entity ' + entity);
    for (const row of rows) {
      for (const field of Object.keys(row))
        if (!fields.has(field)) throw new Error('Unknown field ' + entity + '.' + field);
    }
    const key = schema.database + '.' + entity;
    if (!rows.length) delete preview[key];
    else preview[key] = op === 'replace_rows' ? rows : [...(preview[key] ?? []), ...rows];
  }
  const next = { version: 1, dialect, source, preview };
  serializeDraft(next);
  compile(source, dialect, preview);
  let changes;
  try {
    changes = compareSchemas(draft.source, source, dialect).changes;
  } catch {
    changes = ['Replace invalid source'];
  }
  if (!changes.length && source !== draft.source) changes.push('Update source formatting or comments');
  const seedChanges = [];
  for (const key of new Set([...Object.keys(draft.preview), ...Object.keys(preview)])) {
    const before = draft.preview[key] ?? [];
    const after = preview[key] ?? [];
    if (JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))) continue;
    seedChanges.push({ entity: key, before, after });
    changes.push('Update seed for ' + key + ' (' + before.length + ' → ' + after.length + ' rows)');
  }
  return { ...next, changes, seedChanges };
}

export function proposeDraftEdits(input, edits) {
  const base = validateDraft(input);
  serializeDraft(base);
  const operations = draftOperations.parse(edits);
  const { changes } = applyOperations(base, operations);
  const proposal = { kind: 'schema-studio-draft-edits', version: 1, base, operations, changes };
  if (new TextEncoder().encode(JSON.stringify(proposal, null, 2)).length > maxDraftBytes)
    throw new Error('Proposal is too large.');
  return proposal;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])])
    );
  }
  return value;
}

export function reviewDraftEdits(proposal, current) {
  if (proposal?.kind !== 'schema-studio-draft-edits' || proposal.version !== 1)
    throw new Error('Invalid draft edit proposal.');
  assertDraftBase(proposal.base, current);
  return applyOperations(validateDraft(current), draftOperations.parse(proposal.operations));
}

export function assertDraftBase(expected, current) {
  const base = validateDraft(expected);
  const draft = validateDraft(current);
  if (
    base.dialect !== draft.dialect ||
    normalize(base.source) !== normalize(draft.source) ||
    JSON.stringify(canonical(base.preview)) !== JSON.stringify(canonical(draft.preview))
  ) {
    throw new Error(
      'The proposal base differs from the current schema or preview rows. Ask the agent to read the current draft and submit a new proposal.'
    );
  }
}
