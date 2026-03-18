import { spawn } from "node:child_process";
import { logger } from "../utils/logger";
import { AppError } from "../utils/appError";

const runGitCommand = (args: string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: "pipe" });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new AppError(`Failed to execute git command: ${error.message}`, 500));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AppError(`Git command failed: git ${args.join(" ")} ${stderr.trim()}`, 500));
        return;
      }
      resolve();
    });
  });

export const gitService = {
  async commitAndPush(message: string): Promise<{ success: true }> {
    const repoPath = process.env.GIT_REPO_PATH || process.cwd();
    logger.info("Running git add/commit/push", { repoPath, message });

    await runGitCommand(["add", "."], repoPath);
    await runGitCommand(["commit", "-m", message], repoPath);
    await runGitCommand(["push"], repoPath);

    return { success: true };
  }
};
