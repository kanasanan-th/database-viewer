import { dialects } from './schema.mjs';

export const maxDraftBytes = 700_000;
const name = /^(?!__proto__$)[a-z_]\w{0,62}$/i;

export function validateDraft(draft) {
  if (
    draft?.version !== 1 ||
    !Object.hasOwn(dialects, draft.dialect) ||
    typeof draft.source !== 'string' ||
    draft.source.length > 100_000
  ) {
    throw new Error('Invalid schema draft.');
  }
  const preview = draft.preview ?? {};
  if (
    typeof preview !== 'object' ||
    Array.isArray(preview) ||
    Object.entries(preview).some(([key, rows]) => {
      const parts = key.split('.');
      return (
        parts.length !== 2 ||
        !parts.every(part => name.test(part)) ||
        !Array.isArray(rows) ||
        rows.some(
          row =>
            !row ||
            typeof row !== 'object' ||
            Array.isArray(row) ||
            Object.entries(row).some(([field, value]) => !name.test(field) || typeof value !== 'string')
        )
      );
    })
  )
    throw new Error('Invalid preview rows in draft.');
  const layout = validateLayout(draft.layout);
  return { version: 1, dialect: draft.dialect, source: draft.source, preview, layout };
}

// Positions of the diagram boxes the user arranged, keyed by table or collection name.
export function validateLayout(layout = {}) {
  if (
    typeof layout !== 'object' ||
    layout === null ||
    Array.isArray(layout) ||
    Object.entries(layout).some(
      ([key, point]) =>
        !name.test(key) ||
        !point ||
        typeof point !== 'object' ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Math.abs(point.x) > 1e6 ||
        Math.abs(point.y) > 1e6
    )
  )
    throw new Error('Invalid diagram layout in draft.');
  return Object.fromEntries(
    Object.entries(layout).map(([key, { x, y }]) => [key, { x: Math.round(x), y: Math.round(y) }])
  );
}

export function serializeDraft(draft) {
  const { preview, layout, ...schema } = validateDraft(draft);
  const text = JSON.stringify(
    { ...schema, ...(Object.keys(preview).length && { preview }), ...(Object.keys(layout).length && { layout }) },
    null,
    2
  );
  if (new TextEncoder().encode(text).length > maxDraftBytes) throw new Error('Draft exceeds 700 KB.');
  return text;
}
