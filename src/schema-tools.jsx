import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { compile } from './schema.mjs';
import { importSql } from './sql-import.mjs';
import { importDbml } from './dbml.mjs';
import { lintSchema } from './lint.mjs';
import { generateSampleRows } from './sample-data.mjs';
import { compareSchemas, reviewProposal } from './schema-compare.mjs';
import { reviewDraftEdits } from './draft-edits.mjs';
import { maxDraftBytes, validateDraft } from './draft.mjs';
import { reviewDiff, seedLines, sourceLines } from './review-diff.mjs';

const modes = {
  seed: 'Export with data',
  compare: 'Compare & migrate',
  import: 'Import SQL',
  dbml: 'Import DBML',
  lint: 'Schema lint',
  sample: 'Sample data',
  proposal: 'Review MCP proposal',
  history: 'MCP review history',
  sandbox: 'SQL Sandbox',
};
const labels = { compare: 'Base draft', import: 'SQL DDL', dbml: 'DBML', proposal: 'Proposal JSON' };

function ProposalDiff({ label, before, after, toLines }) {
  const lines = useMemo(() => reviewDiff(toLines(before), toLines(after)), [before, after, toLines]);
  const [showAll, setShowAll] = useState(false);
  const added = lines.filter(line => line.kind === 'added').length;
  const removed = lines.filter(line => line.kind === 'removed').length;
  if (!added && !removed) return <p>{label}: no changes.</p>;
  const visible = index => showAll || lines.slice(Math.max(0, index - 2), index + 3).some(line => line.kind !== 'same');
  return <section className="proposal-diff" aria-label={label}>
    <div className="preview-actions">
      <strong>{label}</strong>
      <span className="diff-added">+{added} added</span>
      <span className="diff-removed">−{removed} removed</span>
      <button type="button" aria-pressed={showAll} onClick={() => setShowAll(value => !value)}>Show unchanged</button>
    </div>
    <div className="diff-scroll" tabIndex={0} role="region" aria-label={label + ' changes'}>
      <table className="diff-table">
        <thead><tr><th scope="col">Old</th><th scope="col">New</th><th scope="col">Change</th></tr></thead>
        <tbody>{lines.map((line, index) => {
          if (!visible(index)) return (index === 0 || visible(index - 1)) &&
            <tr key={index}><td colSpan={3} className="diff-omitted">⋯ Unchanged content</td></tr>;
          return <tr className={'diff-' + line.kind} key={index}>
            <td>{line.old}</td><td>{line.next}</td>
            <td>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}{line.text}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

function SandboxQuery({ dialect, table, run }) {
  const [query, setQuery] = useState(() => table ? 'SELECT * FROM "' + table + '" LIMIT 25;' :
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name;");
  const [includeRows, setIncludeRows] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  if (!run) return <p>Open Schema Studio in Electron to run the SQL Sandbox.</p>;
  if (dialect !== 'sqlite') return <p>Select SQLite as the Database Engine to run the open draft here.</p>;

  return <>
    <form onSubmit={async event => {
      event.preventDefault();
      if (running) return;
      setRunning(true);
      setResult(null);
      setError('');
      try { setResult(await run(query, includeRows)); }
      catch (error) { setError(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
      finally { setRunning(false); }
    }}>
      <p>Try a read-only query. Each run loads the open SQLite draft into a fresh in-memory database.</p>
      <label><input type="checkbox" checked={includeRows} disabled={running}
        onChange={event => { setIncludeRows(event.target.checked); setResult(null); setError(''); }} /> Include preview rows</label>
      <textarea aria-label="SQLite query" value={query} maxLength={20_000} spellCheck={false} disabled={running}
        onChange={event => { setQuery(event.target.value); setResult(null); setError(''); }} />
      <button className="primary" disabled={running || !query.trim()}>{running ? 'Running…' : 'Run query'}</button>
    </form>
    {error && <p role="alert" className="preview-error">{error}</p>}
    {result && <>
      <p role="status">{result.truncated ? 'Showing the first ' : ''}{result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'}</p>
      <div className="preview-scroll sandbox-results">
        <table aria-label="Query results">
          <thead><tr>{result.columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
          <tbody>{result.rows.map((row, index) => <tr key={index}>
            {row.map((value, column) => <td key={column}>{value === null ? <em>NULL</em> : value}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </>;
}

function LintReport({ source, dialect }) {
  const report = useMemo(() => {
    try { return { issues: lintSchema(compile(source, dialect).schema, dialect) }; }
    catch (error) { return { error: error.message }; }
  }, [source, dialect]);
  if (report.error) return <p role="alert" className="preview-error">{report.error}</p>;
  if (!report.issues.length) return <p role="status">No problems found.</p>;
  return <ul aria-label="Lint results" className="lint-list">{report.issues.map((issue, index) => <li key={index} className={'lint-' + issue.severity}>
    <strong>{issue.severity}</strong> {issue.entity && <code>{issue.entity}{issue.field ? '.' + issue.field : ''}</code>} {issue.message}
  </li>)}</ul>;
}

function SampleData({ source, dialect, preview, apply }) {
  const [count, setCount] = useState(5);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const hasRows = Object.values(preview).some(rows => rows.length);
  return <form onSubmit={event => {
    event.preventDefault();
    setError('');
    setDone('');
    try {
      const rows = generateSampleRows(compile(source, dialect).schema, dialect, Number(count));
      compile(source, dialect, rows);
      apply(rows);
      setDone('Generated ' + count + ' rows for each table. Open Preview on a table to see them.');
    } catch (error) { setError(error.message); }
  }}>
    <p>Fill every table or collection with example rows. Values follow the field types, foreign keys point at existing rows, and the same schema always gives the same rows.</p>
    {hasRows && <p role="status">This replaces the preview rows already in the draft.</p>}
    <label>Rows per table <input type="number" min="1" max="200" value={count} onChange={event => { setCount(event.target.value); setDone(''); }} /></label>
    <button className="primary">Generate sample rows</button>
    {error && <p role="alert" className="preview-error">{error}</p>}
    {done && <p role="status">{done}</p>}
  </form>;
}

export function SchemaTools({ dialect, source, preview, table, runSandbox, save, applyImport, applyPreview, mcpImports, reviewHistory, decideProposal, onClose }) {
  const dialog = useRef(null);
  const [mode, setMode] = useState('seed');
  const [input, setInput] = useState('');
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [imports, setImports] = useState([]);
  const [queued, setQueued] = useState(null);
  const [allowDestructive, setAllowDestructive] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    if (mode !== 'proposal' || !mcpImports) return;
    let active = true;
    mcpImports.listMcpImports().then(items => { if (active) setImports(items); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [mode, mcpImports]);

  function update(value) {
    setInput(value);
    setReview(null);
    setError('');
    setQueued(null);
  }

  async function decide(decision) {
    decideProposal(review ?? queued.proposal, decision);
    setMode('history');
    update('');
    if (queued) {
      try {
        await mcpImports.removeMcpImport(queued.id);
        setImports(previous => previous.filter(item => item.id !== queued.id));
      }
      catch (error) { setError(error.message); }
    }
  }

  async function openImport(id) {
    update('');
    setSaving(true);
    try {
      const proposal = await mcpImports.readMcpImport(id);
      if (!proposal) throw new Error('This proposal is no longer pending.');
      setQueued({ id, proposal });
      setReview(reviewDraftEdits(proposal, { version: 1, dialect, source, preview }));
    } catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }

  function inspect(event) {
    event.preventDefault();
    setError('');
    try {
      if (mode === 'seed') {
        const result = compile(source, dialect, preview);
        setReview({ script: result.script, filename: result.schema.database + '_with_data.' + result.extension });
      } else if (mode === 'compare') {
        const raw = input.replace(/^\uFEFF/, '');
        const draft = raw.trimStart().startsWith('{') ? validateDraft(JSON.parse(raw)) : { source: raw, dialect };
        if (draft.dialect !== dialect) throw new Error('Compare drafts that use the same engine.');
        const result = compareSchemas(draft.source, source, dialect, { allowDestructive });
        setReview({ ...result, filename: 'migration.sql' });
      } else if (mode === 'import') {
        setReview({ source: importSql(input, dialect) });
      } else if (mode === 'dbml') {
        setReview(importDbml(input, dialect));
      } else {
        const parsed = JSON.parse(input);
        if (parsed?.kind === 'schema-studio-draft-edits') {
          setReview(reviewDraftEdits(parsed, { version: 1, dialect, source, preview }));
        } else {
          const proposal = reviewProposal(input, dialect, source);
          setReview({ source: proposal.source, changes: proposal.changes });
        }
      }
    } catch (error) {
      setReview(null);
      setError(error.message);
    }
  }

  return <dialog className="help schema-tools" ref={dialog} onClose={onClose} aria-labelledby="tools-title">
    <header><h2 id="tools-title">Schema tools</h2><button aria-label="Close schema tools" onClick={() => dialog.current.close()}><X size={16} /></button></header>
    <div className="tabs">{Object.entries(modes).map(([id, label]) => (
      <button key={id} type="button" aria-pressed={mode === id} disabled={saving}
        onClick={() => { setMode(id); update(''); }}>{label}</button>
    ))}</div>
    {mode === 'proposal' && mcpImports && <section className="mcp-imports" aria-label="MCP review queue">
      <div className="preview-actions">
        <strong>Pending MCP proposals</strong>
        <button disabled={saving} onClick={async () => {
          try { setImports(await mcpImports.listMcpImports()); }
          catch (error) { setError(error.message); }
        }}>Refresh proposals</button>
      </div>
      {imports.length ? <ul>{imports.map(item => <li key={item.id}>
        <span>{item.entity ? item.entity + ' · ' + item.rowCount + ' seed rows' :
          item.changeCount + (item.changeCount === 1 ? ' change' : ' changes')} · {item.dialect}</span>
        <button disabled={saving} onClick={() => openImport(item.id)}>Review proposal</button>
      </li>)}</ul> : <p>No pending proposals.</p>}
    </section>}
    {mode === 'history' ? <section aria-label="MCP proposal decisions">
      {reviewHistory.length ? <ol className="review-history">{reviewHistory.map(entry => (
        <li key={entry.id}>
          <strong>{entry.decision}</strong> · {entry.database} · {entry.dialect} · <time dateTime={entry.date}>{new Date(entry.date).toLocaleString()}</time>
          <ul>{entry.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
        </li>
      ))}</ol> : <p>No proposal decisions yet.</p>}
    </section> : mode === 'sandbox' ? <SandboxQuery dialect={dialect} table={table} run={runSandbox} /> :
      mode === 'lint' ? <LintReport source={source} dialect={dialect} /> :
        mode === 'sample' ? <SampleData source={source} dialect={dialect} preview={preview} apply={applyPreview} /> : !queued && <form onSubmit={inspect}>
      {mode === 'seed' ? <p>Generate one script with the schema and its draft preview rows.</p> : <>
        <p>{mode === 'compare' ? 'Provide the base draft. The open draft is the migration target.' :
          mode === 'import' ? 'Paste SQL or open a DDL file to convert it to a draft.' :
            mode === 'dbml' ? 'Paste DBML from dbdiagram.io (or open a .dbml file) to convert it to a draft.' :
            'Paste the JSON returned by propose_schema or propose_draft_edits to review the changes.'}</p>
        <label className="tool-file"><span>Open file</span><input key={mode} type="file" accept={mode === 'import' ? '.sql,.txt' : mode === 'dbml' ? '.dbml,.txt' : '.schema,.json,.txt'}
          onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > maxDraftBytes) { setError('File is too large.'); return; }
            try { update(await file.text()); } catch (error) { setError(error.message); }
          }} /></label>
        <textarea aria-label={labels[mode]} value={input} maxLength={maxDraftBytes}
          spellCheck={false} onChange={event => update(event.target.value)} />
      </>}
      {mode === 'compare' && <label><input type="checkbox" checked={allowDestructive} onChange={event => { setAllowDestructive(event.target.checked); setReview(null); }} /> Include data-changing statements (DROP, type and NOT NULL changes)</label>}
      <button className="primary" disabled={saving || mode !== 'seed' && !input.trim()}>Review</button>
    </form>}
    {error && <p role="alert" className="preview-error">{error}</p>}
    {queued && !review && <button onClick={() => decide('Rejected')}>Reject proposal</button>}
    {review && <section aria-label="Review result">
      {review.changes && <ul>{review.changes.length ? review.changes.map(change => <li key={change}>{change}</li>) : <li>No structural changes</li>}</ul>}
      {review.risky?.length > 0 && !review.blocked?.length && <p role="status">This script changes or removes data. Back up before running it.</p>}
      {review.warnings?.length > 0 && <>
        <p role="status">Changed during import</p>
        <ul>{review.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      </>}
      {review.blocked?.length > 0 && <>
        <p role="status">Manual migration required</p>
        <ul>{review.blocked.map(reason => <li key={reason}>{reason}</li>)}</ul>
      </>}
      {review.script && <>
        <pre aria-label="Script preview">{review.script}</pre>
        <button disabled={saving} onClick={async () => {
          setSaving(true);
          setError('');
          try { await save(review.filename, review.script); } catch (error) { setError(error.message); }
          finally { setSaving(false); }
        }}>Save script</button>
      </>}
      {review.source && <>
        {(mode === 'import' || mode === 'dbml') && <p>Applying replaces the open draft and its preview rows for this engine.</p>}
        {mode === 'proposal'
          ? <ProposalDiff label="Schema source" before={source} after={review.source} toLines={sourceLines} />
          : <pre aria-label="Imported source">{review.source}</pre>}
        {review.seedChanges?.map(({ entity, before, after }) =>
          <ProposalDiff key={entity} label={'Seed rows: ' + entity} before={before} after={after} toLines={seedLines} />)}
        {mode === 'proposal' ? <div className="preview-actions">
          <button className="primary" onClick={() => decide('Approved')}>Approve and apply</button>
          <button onClick={() => decide('Rejected')}>Reject proposal</button>
        </div> : <button className="primary" onClick={() => {
          applyImport(review.source);
          dialog.current.close();
        }}>Apply to draft</button>}
      </>}
    </section>}
  </dialog>;
}
