import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import { gitRouter } from "./routes/git";
import { registerMcpRoutes } from "./routes/mcp";
import { vercelRouter } from "./routes/vercel";
import { AppError } from "./utils/appError";
import { logger } from "./utils/logger";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/vercel", vercelRouter);
app.use("/git", gitRouter);
registerMcpRoutes(app);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      message: "Not found"
    }
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    logger.error("Request failed", { message: err.message, statusCode: err.statusCode });
    res.status(err.statusCode).json({
      error: {
        message: err.message
      }
    });
    return;
  }

  if (err instanceof Error) {
    logger.error("Unhandled server error", { message: err.message });
  } else {
    logger.error("Unknown unhandled server error");
  }

  res.status(500).json({
    error: {
      message: "Internal server error"
    }
  });
});

app.listen(port, () => {
  logger.info("MCP tool server started", { port });
});
