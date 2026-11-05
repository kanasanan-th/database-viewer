export const mcpClients = {
  codex: 'Codex',
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
};

export function stdioConfig(path) {
  return JSON.stringify({ mcpServers: { 'schema-studio': { command: 'node', args: [path] } } }, null, 2);
}

export function httpConfig(client, { url, token }) {
  if (!Object.hasOwn(mcpClients, client)) throw new Error('Unknown MCP client.');
  const authorization = 'Bearer ' + token;
  if (client === 'codex') return [
    '[mcp_servers.schema_studio]',
    'url = ' + JSON.stringify(url),
    'http_headers = { Authorization = ' + JSON.stringify(authorization) + ' }',
  ].join('\n');
  const endpoint = client === 'gemini' ? { httpUrl: url } : { type: 'http', url };
  return JSON.stringify({
    mcpServers: { 'schema-studio': { ...endpoint, headers: { Authorization: authorization } } },
  }, null, 2);
}
