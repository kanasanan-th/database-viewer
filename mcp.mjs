import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSchemaMcpServer } from './src/mcp-server.mjs';

await createSchemaMcpServer().connect(new StdioServerTransport());
