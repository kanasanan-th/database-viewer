import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createSchemaMcpServer } from '../src/mcp-server.mjs';
import { serializeDraft } from '../src/draft.mjs';

const host = '127.0.0.1';
const maxBody = 1_500_000;
const maxConcurrent = 8;

function authorized(header, token) {
  const given = Buffer.from(String(header ?? ''));
  const expected = Buffer.from('Bearer ' + token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const maxActivity = 50;
const toolLabels = {
  get_active_draft: 'read the open draft',
  submit_draft_edits: 'submitted draft edits',
  import_preview_rows: 'submitted seed rows',
};

const clip = value =>
  String(value ?? '')
    .replace(/[^\w .@/:+-]/g, '')
    .slice(0, 60);

export function createMcpConnection({ onActivity } = {}) {
  let listener = null;
  let connection = null;
  let pending = Promise.resolve();
  let activeDraft = null;
  let client = 'An agent';
  let active = 0;
  const imports = new Map();
  const activity = [];
  // Activity feeds a notification only; a failing listener must never break an MCP request.
  function record(kind, message, extra = {}) {
    const event = { id: randomUUID(), kind, message, date: new Date().toISOString(), ...extra };
    activity.unshift(event);
    activity.length = Math.min(activity.length, maxActivity);
    try {
      onActivity?.(event);
    } catch {
      /* Ignored on purpose. */
    }
  }
  function observe(body) {
    for (const message of Array.isArray(body) ? body : [body]) {
      if (message?.method === 'initialize') {
        client = clip(message.params?.clientInfo?.name) || 'An agent';
        record('connected', 'Agent “' + client + '” connected', { client });
      } else if (message?.method === 'tools/call') {
        const tool = clip(message.params?.name);
        record('tool', 'Agent “' + client + '” ' + (toolLabels[tool] ?? 'called ' + clip(tool)), { client, tool });
      }
    }
  }
  function enqueueImport(proposal, entity, rowCount) {
    if (imports.size >= 20) throw new Error('The MCP review queue is full. Review pending proposals in Schema Studio.');
    const id = randomUUID();
    const summary = {
      id,
      entity,
      rowCount,
      changeCount: proposal.changes.length,
      dialect: proposal.base.dialect,
      date: new Date().toISOString(),
    };
    imports.set(id, { summary, proposal });
    record(
      'proposal',
      'Agent “' +
        client +
        '” proposed ' +
        (entity
          ? rowCount + ' seed rows for ' + entity
          : summary.changeCount + (summary.changeCount === 1 ? ' change' : ' changes')) +
        ' — review required',
      { client, id }
    );
    return id;
  }
  function schedule(action) {
    const next = pending.then(action);
    pending = next.catch(() => {});
    return next;
  }

  async function serve(req, res, token, address) {
    if (req.url !== '/mcp' || req.headers.host !== address || req.headers.origin) {
      res.writeHead(404).end();
      return;
    }
    if (!authorized(req.headers.authorization, token)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }

    if (active >= maxConcurrent) {
      res.writeHead(503, { 'Retry-After': '1' }).end();
      return;
    }
    active++;
    res.once('close', () => {
      active--;
    });
    const server = createSchemaMcpServer({ enqueueImport, getActiveDraft: () => activeDraft });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => {
      void server.close();
    });
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBody) {
          res.writeHead(413, { Connection: 'close' }).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      observe(body);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) {
        res
          .writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid MCP request' } }));
      } else if (!res.writableEnded) res.end();
    }
  }

  return {
    setActiveDraft(draft) {
      activeDraft = null;
      if (draft === null) return;
      const text = serializeDraft(draft);
      activeDraft = {
        draft: { preview: {}, ...JSON.parse(text) },
        revision: createHash('sha256').update(text).digest('hex'),
      };
    },
    status: () => connection,
    listActivity: () => [...activity],
    listImports: () => [...imports.values()].map(entry => entry.summary),
    readImport: id => imports.get(id)?.proposal ?? null,
    removeImport: id => imports.delete(id),
    start: () =>
      schedule(async () => {
        if (connection) return connection;
        const token = randomBytes(32).toString('base64url');
        client = 'An agent';
        const http = createServer({ requestTimeout: 10_000 }, (req, res) => {
          const address = http.address();
          if (!address) {
            res.writeHead(503).end();
            return;
          }
          void serve(req, res, token, host + ':' + address.port);
        });
        return new Promise((resolve, reject) => {
          http.once('error', reject);
          http.listen(0, host, () => {
            listener = http;
            connection = { url: 'http://' + host + ':' + http.address().port + '/mcp', token };
            resolve(connection);
          });
        });
      }),
    close: () =>
      schedule(async () => {
        if (!listener) return null;
        const http = listener;
        listener = null;
        connection = null;
        return new Promise((resolve, reject) => {
          http.close(error => (error ? reject(error) : resolve(null)));
          http.closeAllConnections();
        });
      }),
  };
}
