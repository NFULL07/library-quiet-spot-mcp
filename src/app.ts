import { performance } from "node:perf_hooks";
import express, { Express, Request } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "./config.js";
import { Data4LibraryClient } from "./data4library.js";
import { createJsonLogger, Logger } from "./logger.js";
import { createRequestContext, getRequestContext, RequestContext, runWithRequestContext } from "./request-context.js";
import { callTool, TOOL_DEFINITIONS } from "./tools.js";

export type AppDependencies = {
  client?: Data4LibraryClient;
  logger?: Logger;
};

export function createApp(config: AppConfig, dependencies: AppDependencies = {}): Express {
  const logger = dependencies.logger ?? createJsonLogger({ minimumLevel: config.logLevel });
  const client = dependencies.client ?? new Data4LibraryClient(config, { logger });
  const app = express();

  app.use((req, res, next) => {
    const requestId = resolveRequestId(req);
    const context = createRequestContext(requestId);
    const startedAt = performance.now();
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      logger.info("http.request.completed", {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: elapsedMs(startedAt)
      });
    });
    runWithRequestContext(context, next);
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/ready", (_req, res) => {
    const ready = client.hasAuthKey();
    res.status(ready ? 200 : 503).json({
      ready,
      authKeyConfigured: ready,
      kakaoRestApiKeyConfigured: client.hasKakaoRestApiKey(),
      aladinTtbKeyConfigured: client.hasAladinTtbKey(),
      cacheSize: client.cacheSize,
      circuits: client.circuitStatus
    });
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Use POST /mcp for stateless Streamable HTTP." });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Use POST /mcp for stateless Streamable HTTP." });
  });

  app.post("/mcp", async (req, res) => {
    const context = getRequestContext() ?? createRequestContext();
    const mcpServer = createMcpServer(client, context, logger);
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
      logger.error("mcp.request.failed", {
        requestId: context.requestId,
        error
      });
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

  return app;
}

export function createMcpServer(
  client: Data4LibraryClient,
  context: RequestContext,
  logger: Logger
): Server {
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
    const startedAt = performance.now();
    const toolName = request.params.name;
    const args = isRecord(request.params.arguments) ? request.params.arguments : {};
    const text = await callTool(client, toolName, args, context);
    logger.info("mcp.tool.completed", {
      requestId: context.requestId,
      toolName,
      durationMs: elapsedMs(startedAt),
      outputChars: text.length,
      staleFallbacks: context.staleNotices.length
    });
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

function resolveRequestId(req: Request): string {
  const incoming = req.header("x-request-id")?.trim();
  if (incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming)) return incoming;
  return createRequestContext().requestId;
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
