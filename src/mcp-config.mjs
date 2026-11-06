export const mcpClients = {
  codex: 'Codex',
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
};

export const mcpCopyKinds = {
  config: 'configuration',
  command: 'command',
  url: 'URL',
  token: 'token',
};

export function stdioConfig(path) {
  return JSON.stringify({ mcpServers: { 'schema-studio': { command: 'node', args: [path] } } }, null, 2);
}

function assertClient(client) {
  if (!Object.hasOwn(mcpClients, client)) throw new Error('Unknown MCP client.');
}

export function maskToken(token) {
  return token.length > 10 ? token.slice(0, 4) + '…' + token.slice(-4) : '…';
}

export function httpConfig(client, { url, token }) {
  assertClient(client);
  const authorization = 'Bearer ' + token;
  if (client === 'codex')
    return [
      '[mcp_servers.schema_studio]',
      'url = ' + JSON.stringify(url),
      'http_headers = { Authorization = ' + JSON.stringify(authorization) + ' }',
    ].join('\n');
  const endpoint = client === 'gemini' ? { httpUrl: url } : { type: 'http', url };
  return JSON.stringify(
    {
      mcpServers: { 'schema-studio': { ...endpoint, headers: { Authorization: authorization } } },
    },
    null,
    2
  );
}

// One-line registration command, or null when the client has no equivalent (Codex reads config.toml).
export function cliCommand(client, { url, token }) {
  assertClient(client);
  const header = '--header "Authorization: Bearer ' + token + '"';
  if (client === 'claude') return 'claude mcp add --transport http schema-studio ' + url + ' ' + header;
  if (client === 'gemini') return 'gemini mcp add --transport http ' + header + ' schema-studio ' + url;
  return null;
}

// The text placed on the clipboard for each copy button.
export function copyText(client, kind, connection) {
  if (kind === 'url') return connection.url;
  if (kind === 'token') return connection.token;
  if (kind === 'command') {
    const command = cliCommand(client, connection);
    if (!command) throw new Error(mcpClients[client] + ' has no one-line command. Copy the configuration instead.');
    return command;
  }
  if (kind === 'config') return httpConfig(client, connection);
  throw new Error('Unknown copy target.');
}
