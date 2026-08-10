import http from "node:http";
import { URL } from "node:url";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export function createMcpServer(opts: {
  name: string;
  version: string;
  tools: ToolDef[];
  port?: number;
  host?: string;
}) {
  const port = opts.port ?? Number(process.env.PORT || 8788);
  const host = opts.host ?? "0.0.0.0";
  const tools = new Map(opts.tools.map((t) => [t.name, t]));

  async function handleRpc(body: {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  }) {
    const id = body.id ?? null;
    const method = body.method ?? "";
    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: opts.name, version: opts.version },
          },
        };
      }
      if (method === "notifications/initialized" || method === "initialized") {
        return { jsonrpc: "2.0", id, result: {} };
      }
      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: opts.tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };
      }
      if (method === "tools/call") {
        const params = body.params ?? {};
        const name = String(params.name ?? "");
        const args = (params.arguments as Record<string, unknown>) ?? {};
        const tool = tools.get(name);
        if (!tool) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `unknown_tool:${name}` },
          };
        }
        const result = await tool.handler(args);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false,
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method_not_found:${method}` },
      };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          name: opts.name,
          version: opts.version,
          tools: opts.tools.map((t) => t.name),
        }),
      );
      return;
    }
    if (req.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_json" }));
        return;
      }
      const out = await handleRpc(body as never);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return {
    listen() {
      return new Promise<void>((resolve) => {
        server.listen(port, host, () => {
          console.log(`${opts.name} listening on http://${host}:${port}/mcp`);
          resolve();
        });
      });
    },
    server,
    port,
  };
}
