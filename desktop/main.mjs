import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, utilityProcess } from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '../src/schema.mjs';
import { exportPrisma } from '../src/prisma-export.mjs';
import { maxDraftBytes, serializeDraft, validateDraft } from '../src/draft.mjs';
import { exportDbml } from '../src/dbml.mjs';
import { createMcpConnection } from './mcp-connection.mjs';
import { copyText, stdioConfig } from '../src/mcp-config.mjs';

const page = fileURLToPath(new URL('../dist/index.html', import.meta.url));

function createWindow() {
  const window = new BrowserWindow({
    title: 'Schema Studio',
    width: 1440,
    height: 900,
    minWidth: 780,
    minHeight: 620,
    backgroundColor: '#f7f9f9',
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('closed', () => mcpConnection.setActiveDraft(null));
  window.webContents.on('render-process-gone', () => mcpConnection.setActiveDraft(null));
  void window.loadFile(page);
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.senderFrame?.url !== pathToFileURL(page).href || event.senderFrame.parent) {
      throw new Error('Unexpected renderer.');
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    return callback(window, ...args);
  });
}

handle('draft:open', async window => {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'Schema draft', extensions: ['schema', 'txt'] }],
  });
  if (result.canceled) return null;
  const [path] = result.filePaths;
  if ((await stat(path)).size > maxDraftBytes) throw new Error('Draft file is too large.');
  return readFile(path, 'utf8');
});

async function save(window, name, extension, text) {
  const result = await dialog.showSaveDialog(window, {
    defaultPath: name,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, text, 'utf8');
  return true;
}

handle('draft:save', (window, draft) => {
  const text = serializeDraft(draft);
  const name = draft.source.match(/^[\t ]*database[\t ]+([a-z_][a-z_0-9]{0,62})(?=\s|$)/im)?.[1] ?? 'draft';
  return save(window, name + '.schema', 'schema', text);
});

function compileExport(source, dialect, preview, format) {
  if (format === 'prisma') return exportPrisma(source, dialect);
  if (format === 'dbml') {
    const { schema } = compile(source, dialect);
    return { schema, script: exportDbml(schema), extension: 'dbml' };
  }
  if (preview === undefined) return compile(source, dialect);
  const draft = validateDraft({ version: 1, source, dialect, preview });
  return compile(source, dialect, draft.preview);
}

handle('script:export', (window, source, dialect, preview, format) => {
  const { schema, script, extension } = compileExport(source, dialect, preview, format);
  if (format === 'prisma') return save(window, 'schema.prisma', extension, script);
  if (format === 'dbml') return save(window, schema.database + '.dbml', extension, script);
  return save(
    window,
    schema.database + (preview === undefined ? '' : '_with_data') + '.' + extension,
    extension,
    script
  );
});

handle('script:copy', (_window, source, dialect, preview, format) => {
  clipboard.writeText(compileExport(source, dialect, preview, format).script);
});

handle('clipboard:copy', (_window, text) => {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8_000_000) throw new Error('Nothing to copy.');
  clipboard.writeText(text);
});

handle('script:save-reviewed', (window, name, text) => {
  const extension = typeof name === 'string' && name.match(/^[a-z_]\w{0,80}\.(sql|js|svg)$/i)?.[1];
  if (!extension || typeof text !== 'string' || Buffer.byteLength(text) > 8_000_000)
    throw new Error('Invalid script file.');
  return save(window, name, extension, text);
});

const mcpPath = fileURLToPath(new URL('../mcp.mjs', import.meta.url));
handle('mcp:path', () => mcpPath);
function notifyAgentActivity(event) {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) window.webContents.send('mcp:activity', event);
  // Tool reads stay in the in-app feed; only events that need a person reach the OS when the app is in the background.
  if (event.kind === 'tool' || !Notification.isSupported() || windows.some(window => window.isFocused())) return;
  const note = new Notification({ title: 'Schema Studio', body: event.message });
  note.on('click', () => {
    const [window] = windows;
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  note.show();
}
const mcpConnection = createMcpConnection({ onActivity: notifyAgentActivity });
handle('mcp:status', () => mcpConnection.status());
handle('mcp:activity', () => mcpConnection.listActivity());
handle('mcp:set-active-draft', (_window, draft) => mcpConnection.setActiveDraft(draft));
handle('mcp:start', () => mcpConnection.start());
handle('mcp:close', () => mcpConnection.close());
handle('mcp:list-imports', () => mcpConnection.listImports());
handle('mcp:read-import', (_window, id) => mcpConnection.readImport(id));
handle('mcp:remove-import', (_window, id) => mcpConnection.removeImport(id));
handle('mcp:copy-config', (_window, client, kind = 'config') => {
  if (client === 'stdio') {
    clipboard.writeText(stdioConfig(mcpPath));
    return;
  }
  const connection = mcpConnection.status();
  if (!connection) throw new Error('Start MCP before copying connection details.');
  clipboard.writeText(copyText(client, kind, connection));
});
app.on('before-quit', () => {
  void mcpConnection.close();
});

let sandboxProcess = null;
handle('sandbox:query', (_window, source, preview, query) => {
  if (typeof query !== 'string' || !query.trim() || query.length > 20_000 || query.includes('\0')) {
    throw new Error('Enter one SQL query up to 20,000 characters.');
  }
  if (sandboxProcess) throw new Error('Wait for the current sandbox query to finish.');
  const draft = serializeDraft({ version: 1, dialect: 'sqlite', source, preview });
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(fileURLToPath(new URL('./sql-sandbox.mjs', import.meta.url)), [], {
      serviceName: 'Schema Studio SQLite Sandbox',
    });
    sandboxProcess = child;
    const timer = setTimeout(() => {
      reject(new Error('The sandbox stopped after 5 seconds. Try a smaller query.'));
      child.kill();
    }, 5000);
    child.once('spawn', () => child.postMessage({ draft, query }));
    child.once('message', ({ result, error }) => {
      clearTimeout(timer);
      sandboxProcess = null;
      if (error) reject(new Error(error));
      else resolve(result);
      child.kill();
    });
    child.once('exit', () => {
      clearTimeout(timer);
      if (sandboxProcess === child) sandboxProcess = null;
      reject(new Error('The SQLite sandbox process exited.'));
    });
  });
});

void app.whenReady().then(createWindow);
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
