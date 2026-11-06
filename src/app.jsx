import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  useUpdateNodeInternals,
} from '@xyflow/react';
import { Box, Database, FolderOpen, Save, Download, Table2, Plug, FileCode, CircleHelp, X, Bell } from 'lucide-react';
import { compile, dialects, fieldTypes, mysqlCollations } from './schema.mjs';
import { exportPrisma } from './prisma-export.mjs';
import { exportDbml } from './dbml.mjs';
import { erdSvg } from './erd-svg.mjs';
import { sqlExample, mongoExample, syntaxHelp } from './examples.mjs';
import { SourceEditor } from './source-editor.jsx';
import { TablePreview } from './table-preview.jsx';
import { SchemaTools } from './schema-tools.jsx';
import { CodeBlock, CopyButton } from './code-block.jsx';
import { cliCommand, copyText, httpConfig, maskToken, mcpClients, stdioConfig } from './mcp-config.mjs';
import { maxDraftBytes, serializeDraft, validateDraft } from './draft.mjs';
import '@xyflow/react/dist/style.css';
import './style.css';

const storeKey = 'schema-studio:v1';
const emptyPreview = {};
const emptyLayout = {};
const native = window.studio;
const nodeTypes = { entity: memo(EntityNode) };
const fitOptions = { padding: 0.36, maxZoom: 0.97 };
const handles = [
  [Position.Left, 'left'],
  [Position.Right, 'right'],
];
const sidebarKey = 'schema-studio:sidebar';
const minSidebar = 260;
const clampSidebar = width =>
  Math.round(Math.min(Math.max(width, minSidebar), Math.max(minSidebar, window.innerWidth - 380)));

// Drag, arrow keys or double-click (reset) to size the source panel.
function SidebarResizer({ sidebar, width, onResize, onCommit }) {
  const drag = useRef(null);
  const current = () => width ?? sidebar.current.getBoundingClientRect().width;
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize source panel"
      aria-valuemin={minSidebar}
      aria-valuenow={Math.round(width ?? 0) || undefined}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: sidebar.current.getBoundingClientRect().width };
      }}
      onPointerMove={event => {
        if (drag.current) onResize(clampSidebar(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={() => {
        if (drag.current) {
          drag.current = null;
          onCommit();
        }
      }}
      onDoubleClick={() => onCommit(null)}
      onKeyDown={event => {
        const step = event.shiftKey ? 96 : 24;
        const next =
          event.key === 'ArrowLeft' ? current() - step : event.key === 'ArrowRight' ? current() + step : null;
        if (next === null) return;
        event.preventDefault();
        onCommit(clampSidebar(next));
      }}
    />
  );
}
const engineExample = dialect => (dialect === 'mongodb' ? mongoExample : sqlExample);

function initialDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(storeKey));
    if (Object.hasOwn(dialects, value?.dialect) && typeof value.drafts?.[value.dialect] === 'string') return value;
  } catch {
    /* A fresh draft remains available when storage is disabled. */
  }
  return { dialect: 'postgresql', drafts: { postgresql: sqlExample } };
}

function EntityNode({ id, data }) {
  const { entity } = data;
  const updateInternals = useUpdateNodeInternals();
  useLayoutEffect(() => {
    updateInternals(id);
  }, [entity, id, updateInternals]);
  return (
    <article className="entity">
      <header>
        <Table2 size={20} />
        <strong title={entity.name}>{entity.name}</strong>
        <button
          className="nodrag preview-trigger"
          aria-label={'Preview ' + entity.name}
          onClick={() => data.openPreview(entity.name)}
        >
          Preview
        </button>
      </header>
      {entity.fields.map(field => (
        <div className="field" key={field.name}>
          <span title={field.name}>{field.name}</span>
          <span title={field.type}>
            {field.type} {entity.primary.includes(field.name) ? <em>PK</em> : field.required ? <em>REQ</em> : null}
          </span>
          {handles.map(([position, side]) => (
            <React.Fragment key={side}>
              <Handle
                className="port"
                type="source"
                position={position}
                id={'out:' + side + ':' + field.name}
                isConnectable={false}
              />
              <Handle
                className="port"
                type="target"
                position={position}
                id={'in:' + side + ':' + field.name}
                isConnectable={false}
              />
            </React.Fragment>
          ))}
        </div>
      ))}
      {entity.indexes.length > 0 && (
        <div className="indexes" title={entity.indexes.map(index => index.name).join(', ')}>
          {entity.indexes.length} {entity.indexes.length === 1 ? 'index' : 'indexes'}
        </div>
      )}
    </article>
  );
}

const entityHeight = entity => 52 + entity.fields.length * 35 + (entity.indexes.length ? 28 : 0);

// Boxes the user has placed keep their position; the rest follow the default grid, or sit below the placed ones.
function makeGraph(schema, openPreview, layout = emptyLayout) {
  const placed = schema.entities.filter(entity => layout[entity.name]);
  let y = placed.length ? Math.max(...placed.map(entity => layout[entity.name].y + entityHeight(entity))) + 105 : 0;
  let rowHeight = 0;
  let slot = 0;
  const nodes = schema.entities.map(entity => {
    if (layout[entity.name])
      return { id: entity.name, type: 'entity', position: layout[entity.name], data: { entity, openPreview } };
    if (slot && slot % 2 === 0) {
      y += rowHeight + 105;
      rowHeight = 0;
    }
    rowHeight = Math.max(rowHeight, entityHeight(entity));
    return { id: entity.name, type: 'entity', position: { x: (slot++ % 2) * 424, y }, data: { entity, openPreview } };
  });
  const columns = new Map(nodes.map(node => [node.id, node.position.x]));
  const edges = schema.entities.flatMap(entity =>
    entity.fields
      .filter(field => field.ref)
      .map(field => {
        const left = columns.get(entity.name) > columns.get(field.ref.entity);
        return {
          id: entity.name + '.' + field.name,
          source: entity.name,
          target: field.ref.entity,
          sourceHandle: 'out:' + (left ? 'left' : 'right') + ':' + field.name,
          targetHandle: 'in:' + (left ? 'right' : 'left') + ':' + field.ref.field,
          type: 'default',
          animated: true,
          style: { stroke: '#0d0d0e', strokeWidth: 1.7 },
        };
      })
  );
  return { nodes, edges };
}

function Diagram({ graph, dialect, stale, moved, onMove, onReset }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  useEffect(() => {
    setNodes(previous => {
      const positions = new Map(previous.map(node => [node.id, node.position]));
      return graph.nodes.map(node => ({
        ...node,
        position: moved.has(node.id) ? node.position : (positions.get(node.id) ?? node.position),
      }));
    });
  }, [graph, moved, setNodes]);
  const label = dialect === 'mongodb' ? 'collection' : 'table';
  return (
    <section className="diagram" aria-label="Entity diagram">
      <div className="diagram-caption">
        <h2>Entity diagram</h2>
        <div>
          {graph.nodes.length} {label}
          {graph.nodes.length === 1 ? '' : 's'} <span>·</span> {graph.edges.length} relationship
          {graph.edges.length === 1 ? '' : 's'}
        </div>
        {stale && <small>Showing the last valid schema</small>}
        {moved.size > 0 && (
          <button className="reset-layout" onClick={onReset} title="Forget the box positions you arranged">
            Auto layout
          </button>
        )}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeDragStop={(_event, node, dragged) =>
          onMove(Object.fromEntries((dragged?.length ? dragged : [node]).map(item => [item.id, item.position])))
        }
        fitView
        fitViewOptions={fitOptions}
        minZoom={0.15}
        maxZoom={2}
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={17} size={1.25} color="#c3cde0" />
        <Controls orientation="horizontal" showInteractive={false} fitViewOptions={fitOptions} />
        <MiniMap pannable zoomable nodeColor="#c9d3f6" nodeStrokeColor="#132bcc" maskColor="rgba(238,242,250,.6)" />
      </ReactFlow>
      {!nodes.length && <p className="empty">Write a valid schema to see its entities here.</p>}
    </section>
  );
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const toolList = [
  'schema_syntax',
  'validate_schema',
  'format_schema',
  'export_schema',
  'lint_schema',
  'generate_sample_data',
  'import_dbml',
  'export_dbml',
  'propose_schema',
  'propose_draft_edits',
  'get_active_draft',
  'submit_draft_edits',
  'import_preview_rows',
];

function HelpDialog({ kind, dialect, close }) {
  const dialog = useRef(null);
  const [mcpPath, setMcpPath] = useState('/absolute/path/to/database-viewer/mcp.mjs');
  const [connection, setConnection] = useState(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [mcpClient, setMcpClient] = useState('claude');
  const [reveal, setReveal] = useState(false);
  const [activity, setActivity] = useState([]);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    if (kind !== 'mcp' || !native) return;
    native
      .mcpPath()
      .then(setMcpPath)
      .catch(() => {});
    setConnectionBusy(true);
    native
      .mcpStatus()
      .then(setConnection)
      .catch(error => setConnectionError(error.message))
      .finally(() => setConnectionBusy(false));
    native
      .mcpActivity()
      .then(setActivity)
      .catch(() => {});
    return native.onMcpActivity(event => setActivity(previous => [event, ...previous].slice(0, 50)));
  }, [kind]);
  async function changeConnection() {
    setConnectionBusy(true);
    setConnectionError('');
    setReveal(false);
    try {
      setConnection(await (connection ? native.closeMcp() : native.startMcp()));
    } catch (error) {
      setConnectionError(error.message);
    } finally {
      setConnectionBusy(false);
    }
  }
  const shown = connection && { url: connection.url, token: reveal ? connection.token : maskToken(connection.token) };
  const command = connection && cliCommand(mcpClient, shown);
  const language = command ? 'shell' : mcpClient === 'codex' ? 'toml' : 'json';
  return (
    <dialog ref={dialog} onClose={close} className={'help ' + (kind === 'mcp' ? 'mcp-dialog' : '')}>
      <header>
        <h2>{kind === 'mcp' ? 'Connect an MCP client' : 'Schema syntax'}</h2>
        <button aria-label="Close" onClick={() => dialog.current.close()}>
          <X size={16} />
        </button>
      </header>
      {kind === 'mcp' ? (
        <>
          {native ? (
            <>
              <section className="mcp-card" aria-label="Connection">
                <div className="mcp-status">
                  <span className={'pill ' + (connection ? 'on' : 'off')} role="status">
                    <i />
                    {connection ? 'Running' : 'Closed'}
                  </span>
                  {connection && <code className="mcp-url">{connection.url}</code>}
                  <button className={connection ? '' : 'primary'} disabled={connectionBusy} onClick={changeConnection}>
                    {connection ? 'Close connection' : 'Start MCP connection'}
                  </button>
                </div>
                {!connection && (
                  <p className="hint">
                    Starts a local endpoint on this computer. Agents can read the open draft; edits always wait for your
                    review.
                  </p>
                )}
              </section>
              {connection && (
                <>
                  <section className="mcp-card" aria-label="Client setup">
                    <div className="tabs" role="group" aria-label="MCP client">
                      {Object.entries(mcpClients).map(([id, name]) => (
                        <button key={id} aria-pressed={mcpClient === id} onClick={() => setMcpClient(id)}>
                          {name}
                        </button>
                      ))}
                    </div>
                    <p className="hint">
                      {mcpClient === 'codex'
                        ? 'Paste this into Codex config.toml.'
                        : 'Run this in a terminal to register the server with ' + mcpClients[mcpClient] + '.'}{' '}
                      Each start creates a new address and token, so copy again after restarting.
                    </p>
                    <CodeBlock
                      label={mcpClients[mcpClient] + ' MCP setup'}
                      language={language}
                      numbers={false}
                      maxHeight={200}
                      value={command ?? httpConfig(mcpClient, shown)}
                      copyValue={copyText(mcpClient, command ? 'command' : 'config', connection)}
                    />
                    <div className="preview-actions">
                      {command && (
                        <CopyButton label="Copy configuration" text={copyText(mcpClient, 'config', connection)} />
                      )}
                      <CopyButton label="Copy URL" text={connection.url} />
                      <CopyButton label="Copy token" text={connection.token} />
                      <button type="button" aria-pressed={reveal} onClick={() => setReveal(value => !value)}>
                        {reveal ? 'Hide token' : 'Show token'}
                      </button>
                    </div>
                  </section>
                  <section aria-label="Agent activity" className="mcp-card agent-activity">
                    <strong>Agent activity</strong>
                    {activity.length ? (
                      <ol>
                        {activity.slice(0, 8).map(event => (
                          <li key={event.id} className={event.kind}>
                            <time dateTime={event.date}>{new Date(event.date).toLocaleTimeString()}</time>{' '}
                            {event.message}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="hint">No agent has connected yet.</p>
                    )}
                  </section>
                </>
              )}
            </>
          ) : (
            <p>Open the Electron app to start or close the local MCP server.</p>
          )}
          <details>
            <summary>Independent stdio configuration</summary>
            <p className="hint">The MCP client starts and stops its own stdio process.</p>
            <CodeBlock
              label="stdio MCP configuration"
              language="json"
              numbers={false}
              maxHeight={240}
              value={stdioConfig(mcpPath)}
            />
          </details>
          {connectionError && (
            <p role="alert" className="preview-error">
              {connectionError}
            </p>
          )}
          <div className="tool-list">
            <strong>Tools available</strong>
            <ul className="tool-chips">
              {toolList.map(tool => (
                <li key={tool}>
                  <code>{tool}</code>
                </li>
              ))}
            </ul>
            <p className="hint">Review proposals in Schema tools.</p>
          </div>
        </>
      ) : (
        <>
          <CodeBlock label="Schema syntax" language="schema" numbers={false} maxHeight={320} value={syntaxHelp} />
          <h3>{dialects[dialect]} field types</h3>
          <p>
            <code>{fieldTypes[dialect].join(', ')}</code>
          </p>
          {dialect === 'mysql' && (
            <>
              <h3>Database charsets and collations</h3>
              <dl>
                {Object.entries(mysqlCollations).map(([charset, collations]) => (
                  <React.Fragment key={charset}>
                    <dt>
                      <code>{charset}</code>
                    </dt>
                    <dd>{collations.join(', ')}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </>
          )}
        </>
      )}
    </dialog>
  );
}

function App() {
  const [workspace, setWorkspace] = useState(initialDraft);
  const [tab, setTab] = useState('source');
  const [help, setHelp] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewName, setPreviewName] = useState(null);
  const [showTools, setShowTools] = useState(false);
  const [toolsMode, setToolsMode] = useState('seed');
  const [agentToast, setAgentToast] = useState(null);
  const [pending, setPending] = useState(0);
  const [includeRows, setIncludeRows] = useState(false);
  const [exportFormat, setExportFormat] = useState('native');
  const [loadRev, setLoadRev] = useState(0);
  const fileInput = useRef(null);
  const sidebar = useRef(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(sidebarKey));
    return saved >= minSidebar ? clampSidebar(saved) : null;
  });
  function commitSidebar(next = sidebarWidth) {
    setSidebarWidth(next);
    try {
      next === null ? localStorage.removeItem(sidebarKey) : localStorage.setItem(sidebarKey, String(next));
    } catch {
      /* Width is a convenience only. */
    }
  }
  const { dialect, drafts } = workspace;
  const source = drafts[dialect] ?? engineExample(dialect);
  const result = useMemo(() => {
    try {
      return { value: compile(source, dialect) };
    } catch (error) {
      return { error: error.message };
    }
  }, [source, dialect]);
  const [lastValid, setLastValid] = useState(null);
  useEffect(() => {
    if (result.value) setLastValid({ dialect, schema: result.value.schema });
  }, [result, dialect]);
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(workspace));
    } catch {
      /* Use Save draft when local storage is unavailable. */
    }
  }, [workspace]);
  const schema = result.value?.schema ?? (lastValid?.dialect === dialect ? lastValid.schema : null);
  const layout = workspace.layouts?.[dialect] ?? emptyLayout;
  const moved = useMemo(() => new Set(Object.keys(layout)), [layout]);
  const graph = useMemo(
    () => (schema ? makeGraph(schema, setPreviewName, layout) : { nodes: [], edges: [] }),
    [schema, layout]
  );
  const previewEntity = schema?.entities.find(entity => entity.name === previewName);
  const previewKey = schema?.database + '.' + previewName;
  const preview = workspace.previews?.[dialect] ?? emptyPreview;
  useEffect(() => {
    native?.setMcpDraft({ version: 1, source, dialect, preview }).catch(() => {});
  }, [source, dialect, preview]);
  const refreshPending = () =>
    native
      ?.listMcpImports()
      .then(items => setPending(items.length))
      .catch(() => {});
  useEffect(() => {
    if (!native?.onMcpActivity) return;
    return native.onMcpActivity(event => {
      if (event.kind === 'tool') return;
      setAgentToast(event);
      if (event.kind === 'proposal') refreshPending();
    });
  }, []);
  useEffect(() => {
    if (!agentToast || agentToast.kind === 'proposal') return;
    const timer = setTimeout(() => setAgentToast(null), 6000);
    return () => clearTimeout(timer);
  }, [agentToast]);
  const output = useMemo(() => {
    if (exportFormat === 'dbml' && result.value)
      return { value: { script: exportDbml(result.value.schema), extension: 'dbml' } };
    if (exportFormat === 'prisma' && result.value) {
      try {
        return { value: exportPrisma(source, dialect) };
      } catch (error) {
        return { error: error.message };
      }
    }
    if (!includeRows || !result.value) return result;
    try {
      return { value: compile(source, dialect, preview) };
    } catch (error) {
      return { error: error.message };
    }
  }, [exportFormat, includeRows, result, source, dialect, preview]);

  function edit(nextSource, engine = dialect) {
    setWorkspace(previous => ({ ...previous, dialect: engine, drafts: { ...previous.drafts, [engine]: nextSource } }));
    setNotice('');
  }

  function load(text) {
    let engine = /^\s*collection\s+/m.test(text) ? 'mongodb' : dialect === 'mongodb' ? 'postgresql' : dialect;
    let draft = text.replace(/^\uFEFF/, '');
    let preview = {};
    let loaded = {};
    if (draft.trimStart().startsWith('{')) {
      const parsed = validateDraft(JSON.parse(draft));
      engine = parsed.dialect;
      draft = parsed.source;
      preview = parsed.preview;
      loaded = parsed.layout;
    }
    if (draft.length > 100_000) throw new Error('Draft exceeds 100,000 characters.');
    setWorkspace(previous => ({
      ...previous,
      dialect: engine,
      drafts: { ...previous.drafts, [engine]: draft },
      previews: { ...previous.previews, [engine]: preview },
      layouts: { ...previous.layouts, [engine]: loaded },
    }));
    setLoadRev(rev => rev + 1);
    setLastValid(null);
    setPreviewName(null);
    setTab('source');
    setNotice('Draft opened');
  }

  function moveBoxes(positions) {
    const rounded = Object.fromEntries(
      Object.entries(positions).map(([key, { x, y }]) => [key, { x: Math.round(x), y: Math.round(y) }])
    );
    // The first drag freezes the whole arrangement, so boxes the user did not touch stay where they were.
    const everyBox = Object.fromEntries(
      graph.nodes.map(node => [node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) }])
    );
    setWorkspace(previous => ({
      ...previous,
      layouts: { ...previous.layouts, [dialect]: { ...everyBox, ...previous.layouts?.[dialect], ...rounded } },
    }));
  }

  // Only boxes that still exist in the schema are written to the draft file.
  const savedLayout = () =>
    Object.fromEntries(Object.entries(layout).filter(([key]) => schema?.entities.some(entity => entity.name === key)));

  function updatePreview(rows) {
    const next = { ...preview };
    if (rows.length) next[previewKey] = rows;
    else delete next[previewKey];
    serializeDraft({ version: 1, dialect, source, preview: next });
    setWorkspace(previous => ({ ...previous, previews: { ...previous.previews, [dialect]: next } }));
  }

  async function run(action) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const filename = schema?.database ?? 'draft';
  const prisma = exportFormat === 'prisma';
  const dbml = exportFormat === 'dbml';
  const schemaOnly = prisma || dbml;
  const nativeFormat = dialect === 'mongodb' ? 'mongosh' : 'SQL';
  const exportLabel = prisma ? 'Export Prisma' : dbml ? 'Export DBML' : 'Export ' + nativeFormat;
  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">
          <Box size={28} strokeWidth={2.15} />
          <h1>Schema Studio</h1>
        </div>
        <span className="project" title={filename}>
          {filename}
        </span>
        <div className="actions">
          <label className="engine">
            <Database size={16} aria-hidden="true" />
            <select
              className="themed-select"
              aria-label="Database engine"
              value={dialect}
              onChange={event => {
                const engine = event.target.value;
                edit(
                  drafts[engine] ?? (engine === 'mongodb' || dialect === 'mongodb' ? engineExample(engine) : source),
                  engine
                );
              }}
            >
              {Object.entries(dialects).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <input
            type="file"
            hidden
            ref={fileInput}
            accept=".schema,.txt"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file)
                void run(async () => {
                  if (file.size > maxDraftBytes) throw new Error('Draft file is too large.');
                  load(await file.text());
                });
            }}
          />
          <button
            disabled={busy}
            onClick={() =>
              native
                ? run(async () => {
                    const text = await native.openDraft();
                    if (text !== null) load(text);
                  })
                : fileInput.current.click()
            }
          >
            <FolderOpen size={16} />
            Open
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const draft = { version: 1, dialect, source, preview, layout: savedLayout() };
                if (native) {
                  if (!(await native.saveDraft(draft))) return;
                } else download(filename + '.schema', serializeDraft(draft));
                setNotice('Draft saved');
              })
            }
          >
            <Save size={16} />
            Save draft
          </button>
          <select
            className="themed-select"
            aria-label="Export format"
            value={exportFormat}
            onChange={event => {
              setExportFormat(event.target.value);
              setTab('output');
            }}
          >
            <option value="native">{nativeFormat}</option>
            <option value="prisma">Prisma Schema</option>
            <option value="dbml">DBML</option>
          </select>
          {schemaOnly ? (
            <span className="muted">Schema only</span>
          ) : (
            <label className="seed-toggle">
              <input
                type="checkbox"
                checked={includeRows}
                onChange={event => {
                  setIncludeRows(event.target.checked);
                  setTab('output');
                }}
              />
              Include preview rows
            </label>
          )}
          <button
            className="primary"
            disabled={!output.value || busy}
            onClick={() =>
              run(async () => {
                if (native) {
                  if (
                    !(await native.exportScript(
                      source,
                      dialect,
                      !schemaOnly && includeRows ? preview : undefined,
                      exportFormat
                    ))
                  )
                    return;
                } else
                  download(
                    prisma
                      ? 'schema.prisma'
                      : dbml
                        ? filename + '.dbml'
                        : filename + (includeRows ? '_with_data' : '') + '.' + output.value.extension,
                    output.value.script
                  );
                setNotice('Script exported');
              })
            }
          >
            <Download size={16} />
            {exportLabel}
          </button>
          <button
            disabled={!schema || busy}
            title="Save the diagram as an SVG image, using the box positions you arranged"
            onClick={() =>
              run(async () => {
                const svg = erdSvg(schema, Object.fromEntries(graph.nodes.map(node => [node.id, node.position])));
                if (native) {
                  if (!(await native.saveReviewedScript(filename + '_erd.svg', svg))) return;
                } else download(filename + '_erd.svg', svg);
                setNotice('Diagram exported');
              })
            }
          >
            <Download size={16} />
            Export diagram
          </button>
        </div>
      </header>
      <main className="workspace" style={sidebarWidth ? { '--sidebar': sidebarWidth + 'px' } : undefined}>
        <section className="sidebar" ref={sidebar} aria-label="Schema workspace">
          <div className="side-heading">
            <div className="title-row">
              <h2>Schema source</h2>
              <button
                className="icon-button"
                aria-label="Schema syntax help"
                title="Schema syntax help"
                onClick={() => setHelp('syntax')}
              >
                <CircleHelp size={17} />
              </button>
            </div>
            <div className="tabs">
              <button aria-pressed={tab === 'source'} onClick={() => setTab('source')}>
                Source
              </button>
              <button aria-pressed={tab === 'output'} onClick={() => setTab('output')}>
                Output
              </button>
            </div>
          </div>
          {tab === 'source' ? (
            <SourceEditor key={dialect} source={source} setSource={edit} dialect={dialect} />
          ) : output.value ? (
            <div className="output-pane">
              <CodeBlock
                label="Generated script"
                maxHeight="none"
                language={prisma ? 'prisma' : dbml ? 'dbml' : dialect === 'mongodb' ? 'js' : 'sql'}
                filename={
                  prisma
                    ? 'schema.prisma'
                    : dbml
                      ? filename + '.dbml'
                      : filename + (includeRows ? '_with_data' : '') + '.' + output.value.extension
                }
                value={output.value.script}
              />
            </div>
          ) : (
            <pre className="output" aria-label="Generated script">
              {output.error}
            </pre>
          )}
          <div className={'status ' + (output.error ? 'invalid' : '')} role="status">
            <i />
            {output.error ?? 'Valid'}
          </div>
        </section>
        <SidebarResizer sidebar={sidebar} width={sidebarWidth} onResize={setSidebarWidth} onCommit={commitSidebar} />
        <Diagram
          key={dialect + ':' + loadRev}
          graph={graph}
          dialect={dialect}
          stale={Boolean(result.error && schema)}
          moved={moved}
          onMove={moveBoxes}
          onReset={() => {
            setWorkspace(previous => ({ ...previous, layouts: { ...previous.layouts, [dialect]: {} } }));
            setLoadRev(rev => rev + 1);
          }}
        />
      </main>
      <footer>
        <span>
          <FileCode size={16} />
          Local draft <span className="muted">·</span> {filename}.schema
        </span>
        <span className="notice" role="status">
          {notice}
        </span>
        <button
          className="mcp"
          onClick={() => {
            setToolsMode('seed');
            setShowTools(true);
          }}
        >
          Schema tools
          {pending > 0 && (
            <span className="badge" aria-label={pending + ' pending MCP proposals'}>
              {pending}
            </span>
          )}
        </button>
        <button className="mcp" onClick={() => setHelp('mcp')}>
          <Plug size={16} />
          MCP setup
        </button>
      </footer>
      {agentToast && (
        <div className={'agent-toast ' + agentToast.kind} role="status">
          <Bell size={16} aria-hidden="true" />
          <span>{agentToast.message}</span>
          {agentToast.kind === 'proposal' && (
            <button
              onClick={() => {
                setToolsMode('proposal');
                setShowTools(true);
                setAgentToast(null);
              }}
            >
              Review
            </button>
          )}
          <button aria-label="Dismiss notification" onClick={() => setAgentToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {help && <HelpDialog kind={help} dialect={dialect} close={() => setHelp(null)} />}
      {showTools && (
        <SchemaTools
          initialMode={toolsMode}
          pending={pending}
          dialect={dialect}
          source={source}
          preview={preview}
          mcpImports={native}
          table={result.value?.schema.entities[0]?.name}
          runSandbox={
            native?.runSandboxQuery
              ? (query, includeRows) => native.runSandboxQuery(source, includeRows ? preview : {}, query)
              : undefined
          }
          onClose={() => {
            setShowTools(false);
            void refreshPending();
          }}
          applyImport={next => load(serializeDraft({ version: 1, dialect, source: next }))}
          applyPreview={rows => {
            serializeDraft({ version: 1, dialect, source, preview: rows });
            setWorkspace(previous => ({ ...previous, previews: { ...previous.previews, [dialect]: rows } }));
            setNotice('Sample rows generated');
          }}
          reviewHistory={workspace.reviewHistory ?? []}
          decideProposal={(review, decision) => {
            const entry = {
              id: crypto.randomUUID(),
              date: new Date().toISOString(),
              database: filename,
              dialect,
              decision,
              changes: review.changes.length ? review.changes : ['Source formatting or comments'],
            };
            const approved = decision === 'Approved';
            setWorkspace(previous => ({
              ...previous,
              drafts: approved ? { ...previous.drafts, [dialect]: review.source } : previous.drafts,
              previews:
                approved && review.preview ? { ...previous.previews, [dialect]: review.preview } : previous.previews,
              reviewHistory: [entry, ...(previous.reviewHistory ?? [])].slice(0, 100),
            }));
            if (approved) {
              setTab('source');
              setNotice('Proposal applied');
            } else setNotice('Proposal rejected');
          }}
          save={async (name, script) => {
            if (native) {
              if (!(await native.saveReviewedScript(name, script))) return;
            } else download(name, script);
            setNotice('Script exported');
          }}
        />
      )}
      {previewEntity && (
        <TablePreview
          key={previewKey}
          entity={previewEntity}
          dialect={dialect}
          rows={preview[previewKey] ?? []}
          preview={preview}
          database={schema.database}
          onChange={updatePreview}
          onClose={() => setPreviewName(null)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
