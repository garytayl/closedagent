import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { gitService } from "../services/gitService";
import { vercelService } from "../services/vercelService";
import { logger } from "../utils/logger";

type McpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const sessions = new Map<string, McpSession>();

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const jsonText = (value: unknown): string => JSON.stringify(value, null, 2);

const createToolServer = (): McpServer => {
  const server = new McpServer({
    name: "closedagent-mcp-tools",
    version: "1.0.0"
  });

  server.registerTool(
    "vercel_status",
    {
      title: "Get Latest Deployment Status",
      description: "Get latest Vercel deployment status. projectId is optional.",
      inputSchema: {
        projectId: z.string().optional().describe("Optional Vercel project ID")
      }
    },
    async ({ projectId }) => {
      try {
        const result = await vercelService.getLatestDeploymentStatus(projectId);
        return {
          content: [{ type: "text", text: jsonText(result) }],
          structuredContent: result as unknown as Record<string, unknown>
        };
      } catch (error) {
        const message = getErrorMessage(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { error: { message } }
        };
      }
    }
  );

  server.registerTool(
    "vercel_logs",
    {
      title: "Get Deployment Logs",
      description: "Get Vercel deployment logs by deployment ID.",
      inputSchema: {
        deploymentId: z.string().min(1).describe("Vercel deployment ID")
      }
    },
    async ({ deploymentId }) => {
      try {
        const result = await vercelService.getDeploymentLogs(deploymentId);
        return {
          content: [{ type: "text", text: jsonText(result) }],
          structuredContent: result as unknown as Record<string, unknown>
        };
      } catch (error) {
        const message = getErrorMessage(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { error: { message } }
        };
      }
    }
  );

  server.registerTool(
    "git_commit",
    {
      title: "Commit and Push Changes",
      description: "Run git add, git commit, and git push in the configured repository.",
      inputSchema: {
        message: z.string().min(1).describe("Commit message")
      }
    },
    async ({ message }) => {
      try {
        const result = await gitService.commitAndPush(message);
        return {
          content: [{ type: "text", text: jsonText(result) }],
          structuredContent: result as Record<string, unknown>
        };
      } catch (error) {
        const message = getErrorMessage(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { error: { message } }
        };
      }
    }
  );

  return server;
};

const handleMcpPost = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers["mcp-session-id"];
  const sessionIdValue = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  try {
    if (sessionIdValue && sessions.has(sessionIdValue)) {
      await sessions.get(sessionIdValue)!.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionIdValue && isInitializeRequest(req.body)) {
      const server = createToolServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
          logger.info("Initialized MCP session", { sessionId: newSessionId });
        }
      });

      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId && sessions.has(closedSessionId)) {
          sessions.delete(closedSessionId);
          logger.info("Closed MCP session", { sessionId: closedSessionId });
        }
        void server.close();
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided"
      },
      id: null
    });
  } catch (error) {
    logger.error("Error handling MCP POST request", { message: getErrorMessage(error) });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
};

const handleMcpGet = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers["mcp-session-id"];
  const sessionIdValue = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  if (!sessionIdValue) {
    res.json({
      status: "ok",
      server: "closedagent-mcp-tools",
      mcpEndpoint: "/mcp",
      note: "Use POST /mcp with MCP JSON-RPC initialize request."
    });
    return;
  }

  const session = sessions.get(sessionIdValue);
  if (!session) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  await session.transport.handleRequest(req, res);
};

const handleMcpDelete = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers["mcp-session-id"];
  const sessionIdValue = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  if (!sessionIdValue) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const session = sessions.get(sessionIdValue);
  if (!session) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  await session.transport.handleRequest(req, res);
};

const mountMcpPath = (app: Express, path: string): void => {
  app.post(path, (req, res) => {
    void handleMcpPost(req, res);
  });

  app.get(path, (req, res) => {
    void handleMcpGet(req, res);
  });

  app.delete(path, (req, res) => {
    void handleMcpDelete(req, res);
  });
};

export const registerMcpRoutes = (app: Express): void => {
  mountMcpPath(app, "/mcp");
  mountMcpPath(app, "/");
};
