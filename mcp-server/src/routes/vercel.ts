import { Router, type Request, type Response, type NextFunction } from "express";
import { vercelService } from "../services/vercelService";

export const vercelRouter = Router();

vercelRouter.post(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = req.body?.projectId;

      if (projectId !== undefined && typeof projectId !== "string") {
        res.status(400).json({
          error: {
            message: "projectId must be a string when provided"
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
