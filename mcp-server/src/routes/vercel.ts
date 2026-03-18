import { Router, type Request, type Response, type NextFunction } from "express";
import { vercelService } from "../services/vercelService";

export const vercelRouter = Router();

vercelRouter.post(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = req.body?.projectId ?? process.env.VERCEL_PROJECT_ID;

      if (!projectId || typeof projectId !== "string") {
        res.status(400).json({
          error: {
            message: "projectId is required"
          }
        });
        return;
      }

      const result = await vercelService.getLatestDeploymentStatus(projectId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

vercelRouter.post(
  "/logs",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { deploymentId } = req.body ?? {};

      if (!deploymentId || typeof deploymentId !== "string") {
        res.status(400).json({
          error: {
            message: "deploymentId is required"
          }
        });
        return;
      }

      const result = await vercelService.getDeploymentLogs(deploymentId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);
