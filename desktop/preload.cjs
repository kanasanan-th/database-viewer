const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  openDraft: () => ipcRenderer.invoke('draft:open'),
  saveDraft: draft => ipcRenderer.invoke('draft:save', draft),
  exportScript: (source, dialect, preview, format) => ipcRenderer.invoke('script:export', source, dialect, preview, format),
  copyScript: (source, dialect, preview, format) => ipcRenderer.invoke('script:copy', source, dialect, preview, format),
  saveReviewedScript: (name, text) => ipcRenderer.invoke('script:save-reviewed', name, text),
  runSandboxQuery: (source, preview, query) => ipcRenderer.invoke('sandbox:query', source, preview, query),
  mcpPath: () => ipcRenderer.invoke('mcp:path'),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  setMcpDraft: draft => ipcRenderer.invoke('mcp:set-active-draft', draft),
  startMcp: () => ipcRenderer.invoke('mcp:start'),
  closeMcp: () => ipcRenderer.invoke('mcp:close'),
  listMcpImports: () => ipcRenderer.invoke('mcp:list-imports'),
  readMcpImport: id => ipcRenderer.invoke('mcp:read-import', id),
  removeMcpImport: id => ipcRenderer.invoke('mcp:remove-import', id),
  copyMcpConfig: client => ipcRenderer.invoke('mcp:copy-config', client),
});
