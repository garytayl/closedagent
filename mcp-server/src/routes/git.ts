import { Router, type NextFunction, type Request, type Response } from "express";
import { gitService } from "../services/gitService";

export const gitRouter = Router();

gitRouter.post(
  "/commit",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { message } = req.body ?? {};

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        res.status(400).json({
          error: {
            message: "message is required"
          }
        });
        return;
      }

      const result = await gitService.commitAndPush(message.trim());
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);
