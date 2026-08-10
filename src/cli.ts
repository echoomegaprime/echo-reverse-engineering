#!/usr/bin/env node
import { createMcpServer } from "./lib/mcp-http.js";
import { tools } from "./tools.js";

const name = "echo-reverse-engineering";
const version = "1.0.0";

const server = createMcpServer({
  name,
  version,
  tools,
  port: Number(process.env.PORT || process.env.MCP_PORT || 8788),
});

await server.listen();
