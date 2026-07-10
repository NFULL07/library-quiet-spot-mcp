import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { Data4LibraryClient } from "./data4library.js";
import { callTool, TOOL_DEFINITIONS } from "./tools.js";

const config = loadConfig();
const client = new Data4LibraryClient(config);
const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/ready", (_req, res) => {
  const ready = client.hasAuthKey();
  res.status(ready ? 200 : 503).json({
    ready,
    authKeyConfigured: ready,
    cacheSize: client.cacheSize
  });
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Use POST /mcp for stateless Streamable HTTP." });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: "Use POST /mcp for stateless Streamable HTTP." });
});

app.post("/mcp", async (req, res) => {
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    void transport.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal server error"
        },
        id: null
      });
    }
  }
});

app.listen(config.port, () => {
  console.log(`LibraryQuietSpot MCP listening on port ${config.port}`);
});

function createMcpServer(): Server {
  const server = new Server(
    {
      name: "LibraryQuietSpot",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = isRecord(request.params.arguments) ? request.params.arguments : {};
    const text = await callTool(client, request.params.name, args);
    return {
      content: [
        {
          type: "text",
          text
        }
      ]
    };
  });

  return server;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
