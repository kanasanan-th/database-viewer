import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compile, dialects, fieldTypes, mysqlCollations } from './schema.mjs';
import { syntaxHelp, sqlExample, mongoExample } from './examples.mjs';
import { makeProposal } from './schema-compare.mjs';
import { appendRowsOperation, assertDraftBase, draftOperations, formatSchema, proposeDraftEdits } from './draft-edits.mjs';
import { serializeDraft } from './draft.mjs';
import { lintSchema } from './lint.mjs';
import { exportDbml, importDbml } from './dbml.mjs';
import { generateSampleRows } from './sample-data.mjs';

const inputSchema = { source: z.string().max(100_000), dialect: z.enum(Object.keys(dialects)) };
const previewSchema = z.record(z.string(), z.array(z.record(z.string(), z.string()))).optional();
const annotations = { readOnlyHint: true, openWorldHint: false };
const content = (text, isError = false) => ({ content: [{ type: 'text', text }], isError });

const liveBaseSchema = {
  source: inputSchema.source.optional(),
  dialect: inputSchema.dialect.optional(),
  preview: previewSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
};

export function createSchemaMcpServer({ enqueueImport, getActiveDraft } = {}) {
  const server = new McpServer({ name: 'schema-studio', version: '1.0.0' });
  function activeDraft() {
    const active = getActiveDraft?.();
    if (!active) throw new Error('No active draft is available. Open a draft in Schema Studio and retry.');
    return active;
  }
  function submissionBase({ source, dialect, preview, revision }) {
    const active = activeDraft();
    if (revision !== undefined) {
      if (source !== undefined || dialect !== undefined || preview !== undefined) {
        throw new Error('Pass revision alone as the base, without source, dialect or preview.');
      }
      if (revision !== active.revision) throw new Error('The draft changed. Call get_active_draft and rebuild your operations using its latest revision.');
      return active.draft;
    }
    if (source === undefined || dialect === undefined) throw new Error('Call get_active_draft and pass its revision, or supply source and dialect with the complete preview.');
    try { assertDraftBase({ version: 1, source, dialect, preview }, active.draft); }
    catch (error) { throw new Error(error.message + ' Call get_active_draft to read the current draft.'); }
    return active.draft;
  }
  if (getActiveDraft) server.registerTool('get_active_draft', {
    description: 'Read the open Schema Studio draft, including unsaved source, dialect, seed preview and the revision required when submitting changes.',
    annotations,
  }, () => {
    try { return content(JSON.stringify(activeDraft())); }
    catch (error) { return content(error.message, true); }
  });
  server.registerTool('schema_syntax', { description: 'Read Schema Studio syntax and examples.', annotations },
    () => content([
      syntaxHelp,
      ...Object.entries(fieldTypes).map(([engine, values]) => dialects[engine] + ' types: ' + values.join(', ')),
      ...Object.entries(mysqlCollations).map(([charset, values]) => 'MySQL ' + charset + ' collations: ' + values.join(', ')),
      'SQL example:\n' + sqlExample,
      'MongoDB example:\n' + mongoExample,
    ].join('\n\n')));
  server.registerTool('validate_schema', { description: 'Validate a draft and return its entities, fields, indexes and relationships.', inputSchema, annotations },
    ({ source, dialect }) => {
      try { return content(JSON.stringify(compile(source, dialect).schema, null, 2)); }
      catch (error) { return content(error.message, true); }
    });
  server.registerTool('export_schema', { description: 'Generate SQL or mongosh. Optionally include preview rows keyed by database.entity to export seed data.', inputSchema: { ...inputSchema, preview: previewSchema }, annotations },
    ({ source, dialect, preview }) => {
      try {
        if (preview !== undefined) serializeDraft({ version: 1, source, dialect, preview });
        return content(compile(source, dialect, preview).script);
      }
      catch (error) { return content(error.message, true); }
    });
  server.registerTool('propose_schema', {
    description: 'Validate the current and proposed sources. Return proposal JSON for manual review in Schema Studio.',
    inputSchema: { ...inputSchema, base: z.string().max(100_000) },
    annotations,
  }, ({ base, source, dialect }) => {
    try { return content(JSON.stringify(makeProposal(dialect, base, source), null, 2)); }
    catch (error) { return content(error.message, true); }
  });
  server.registerTool('format_schema', {
    description: 'Validate and normalize draft syntax indentation while preserving comments and definitions.',
    inputSchema, annotations,
  }, ({ source, dialect }) => {
    try { return content(formatSchema(source, dialect)); }
    catch (error) { return content(error.message, true); }
  });
  server.registerTool('lint_schema', {
    description: 'Check a draft for design problems: missing primary keys, foreign key type mismatches, unindexed foreign keys and mixed naming styles. Returns a JSON list of issues with severity.',
    inputSchema, annotations,
  }, ({ source, dialect }) => {
    try { return content(JSON.stringify(lintSchema(compile(source, dialect).schema, dialect), null, 2)); }
    catch (error) { return content(error.message, true); }
  });
  server.registerTool('generate_sample_data', {
    description: 'Generate deterministic sample rows for every table or collection. Returns preview JSON keyed by database.entity that fits export_schema preview, or append_rows and replace_rows operations.',
    inputSchema: { ...inputSchema, rows: z.number().int().min(1).max(200).optional() }, annotations,
  }, ({ source, dialect, rows = 5 }) => {
    try { return content(JSON.stringify(generateSampleRows(compile(source, dialect).schema, dialect, rows), null, 2)); }
    catch (error) { return content(error.message, true); }
  });
  server.registerTool('import_dbml', {
    description: 'Convert DBML (the dbdiagram.io language) to Schema Studio syntax for a SQL engine. Returns the new source and warnings about anything that was changed.',
    inputSchema: { dbml: z.string().max(700_000), dialect: inputSchema.dialect }, annotations,
  }, ({ dbml, dialect }) => {
    try { return content(JSON.stringify(importDbml(dbml, dialect), null, 2)); }
    catch (error) { return content(error.message, true); }
  });
  server.registerTool('export_dbml', { description: 'Convert a draft to DBML.', inputSchema, annotations }, ({ source, dialect }) => {
    try { return content(exportDbml(compile(source, dialect).schema)); }
    catch (error) { return content(error.message, true); }
  });
  server.registerTool('propose_draft_edits', {
    description: 'Return proposal JSON for manual review in Schema Studio. Pass the current draft source and all preview rows. Operations can replace or format source, add entities or fields, append or replace seed rows, or clear all preview rows. Row values are strings keyed by field name.',
    inputSchema: { ...inputSchema, preview: previewSchema, operations: draftOperations },
    annotations,
  }, ({ source, dialect, preview, operations }) => {
    try { return content(JSON.stringify(proposeDraftEdits({ version: 1, source, dialect, preview }, operations), null, 2)); }
    catch (error) { return content(error.message, true); }
  });
  if (enqueueImport) server.registerTool('submit_draft_edits', {
    description: 'Queue source, schema and seed edits in the open app. Call get_active_draft and pass its revision with operations. Put new source in replace_source. Seed operations target the resulting schema. To replace the whole draft, use replace_source, clear_preview, then append_rows per table or collection. App approval is required.',
    inputSchema: { ...liveBaseSchema, operations: draftOperations },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, ({ operations, ...base }) => {
    try {
      const proposal = proposeDraftEdits(submissionBase(base), operations);
      if (!proposal.changes.length) return content('The proposal makes no changes.', true);
      const id = enqueueImport(proposal);
      return content(JSON.stringify({ id, status: 'pending_review', changes: proposal.changes }));
    } catch (error) { return content(error.message, true); }
  });
  if (enqueueImport) server.registerTool('import_preview_rows', {
    description: 'Queue rows for review in the open app. Call get_active_draft and pass its revision with entity and rows. Row values must be strings. App approval is required.',
    inputSchema: { ...liveBaseSchema, entity: appendRowsOperation.shape.entity, rows: appendRowsOperation.shape.rows },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, ({ entity, rows, ...base }) => {
    try {
      const proposal = proposeDraftEdits(submissionBase(base), [{ op: 'append_rows', entity, rows }]);
      const id = enqueueImport(proposal, entity, rows.length);
      return content(JSON.stringify({ id, status: 'pending_review', entity, rowCount: rows.length }));
    } catch (error) { return content(error.message, true); }
  });
  return server;
}
