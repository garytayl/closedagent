import { logger } from "../utils/logger";
import { AppError } from "../utils/appError";

const VERCEL_API_BASE = "https://api.vercel.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

export type DeploymentStatus = "READY" | "ERROR" | "BUILDING";

export interface DeploymentStatusResponse {
  status: DeploymentStatus;
  deploymentId: string;
  url: string;
}

export interface DeploymentLogsResponse {
  logs: string;
}

export interface WaitForDeploymentOptions {
  projectId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  requireNewDeployment?: boolean;
}

export interface WaitForDeploymentResponse extends DeploymentStatusResponse {
  previousDeploymentId: string | null;
  isNewDeployment: boolean;
  attempts: number;
}

type JsonRecord = Record<string, unknown>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeStatus = (rawStatus: string | undefined): DeploymentStatus => {
  if (rawStatus === "READY") {
    return "READY";
  }
  if (rawStatus === "ERROR" || rawStatus === "CANCELED") {
    return "ERROR";
  }
  return "BUILDING";
};

const normalizeDeploymentUrl = (rawUrl: string | undefined): string => {
  if (!rawUrl) {
    return "";
  }
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }
  return `https://${rawUrl}`;
};

const getAuthHeader = (): Record<string, string> => {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new AppError("VERCEL_TOKEN is not configured", 500);
  }
  return {
    Authorization: `Bearer ${token}`
  };
};

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new AppError("Failed to parse Vercel API response", 502);
  }
};

const requestWithRetry = async (
  url: string,
  init: RequestInit,
  retries = DEFAULT_RETRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          logger.warn("Retrying Vercel API request after server error", {
            url,
            status: response.status,
            attempt: attempt + 1
          });
          await sleep(500 * (attempt + 1));
          continue;
        }

        throw new AppError(
          `Vercel API request failed with status ${response.status}`,
          response.status >= 400 && response.status < 500 ? 400 : 502
        );
      }

      return await parseJsonResponse(response);
    } catch (error) {
      clearTimeout(timeout);

      const isAbortError = error instanceof Error && error.name === "AbortError";
      if (isAbortError && attempt < retries) {
        logger.warn("Retrying Vercel API request after timeout", { url, attempt: attempt + 1 });
        await sleep(500 * (attempt + 1));
        continue;
      }

      if (attempt < retries) {
        logger.warn("Retrying Vercel API request after network failure", {
          url,
          attempt: attempt + 1
        });
        await sleep(500 * (attempt + 1));
        continue;
      }

      if (error instanceof AppError) {
        throw error;
      }

      if (isAbortError) {
        throw new AppError("Vercel API request timed out", 504);
      }

      throw new AppError("Vercel API request failed", 502);
    }
  }

  throw new AppError("Vercel API request failed after retries", 502);
};

const extractLogLine = (event: unknown): string => {
  if (!event || typeof event !== "object") {
    return "";
  }
  const eventRecord = event as JsonRecord;

  if (typeof eventRecord.text === "string") {
    return eventRecord.text;
  }
  if (typeof eventRecord.payload === "string") {
    return eventRecord.payload;
  }
  if (eventRecord.payload && typeof eventRecord.payload === "object") {
    return JSON.stringify(eventRecord.payload);
  }
  return JSON.stringify(eventRecord);
};

export const vercelService = {
  async getLatestDeploymentStatus(projectId?: string): Promise<DeploymentStatusResponse> {
    const headers = {
      ...getAuthHeader(),
      "Content-Type": "application/json"
    };

    const params = new URLSearchParams({ limit: "1" });
    if (projectId && projectId.trim().length > 0) {
      params.set("projectId", projectId.trim());
    }
    const url = `${VERCEL_API_BASE}/v6/deployments?${params.toString()}`;

    logger.info("Fetching latest Vercel deployment status", {
      scope: projectId ? "project" : "all-projects",
      projectId: projectId ?? null
    });
    const data = await requestWithRetry(url, {
      method: "GET",
      headers
    });
    if (!isJsonRecord(data)) {
      throw new AppError("Unexpected Vercel API response format", 502);
    }

    const deployments = Array.isArray(data.deployments) ? data.deployments : [];
    if (deployments.length === 0) {
      throw new AppError(
        projectId ? "No deployments found for project" : "No deployments found",
        404
      );
    }

    const latest = deployments[0] as JsonRecord;
    const deploymentId =
      typeof latest.uid === "string"
        ? latest.uid
        : typeof latest.id === "string"
          ? latest.id
          : "";
    const state =
      typeof latest.readyState === "string"
        ? latest.readyState
        : typeof latest.state === "string"
          ? latest.state
          : undefined;
    const rawUrl = typeof latest.url === "string" ? latest.url : "";

    if (!deploymentId || !rawUrl) {
      throw new AppError("Incomplete deployment information received", 502);
    }

    return {
      status: normalizeStatus(state),
      deploymentId,
      url: normalizeDeploymentUrl(rawUrl)
    };
  },

  async getDeploymentLogs(deploymentId: string): Promise<DeploymentLogsResponse> {
    const headers = {
      ...getAuthHeader(),
      "Content-Type": "application/json"
    };

    const endpoints = [
      `${VERCEL_API_BASE}/v3/deployments/${deploymentId}/events?limit=1000`,
      `${VERCEL_API_BASE}/v6/deployments/${deploymentId}/events?limit=1000`
    ];

    logger.info("Fetching Vercel deployment logs", { deploymentId });
    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
      try {
        const data = await requestWithRetry(endpoint, {
          method: "GET",
          headers
        });

        const events = isJsonRecord(data) && Array.isArray(data.events) ? data.events : [];

        const logLines = events
          .map(extractLogLine)
          .filter((line) => line.trim().length > 0);

        return {
          logs: logLines.length > 0 ? logLines.join("\n") : "No logs available."
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown logs retrieval error");
      }
    }

    if (lastError instanceof AppError) {
      throw lastError;
    }

    throw new AppError("Unable to fetch deployment logs", 502);
  },

  async waitForDeploymentAfter(
    previousDeploymentId: string | undefined,
    options: WaitForDeploymentOptions = {}
  ): Promise<WaitForDeploymentResponse> {
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const previousId = previousDeploymentId?.trim() ? previousDeploymentId.trim() : null;
    const requireNewDeployment = options.requireNewDeployment ?? Boolean(previousId);
    const startedAtMs = Date.now();
    let attempts = 0;
    let lastStatus: DeploymentStatusResponse | null = null;

    logger.info("Waiting for Vercel deployment update", {
      previousDeploymentId: previousId,
      projectId: options.projectId ?? null,
      timeoutMs,
      pollIntervalMs,
      requireNewDeployment
    });

    while (Date.now() - startedAtMs <= timeoutMs) {
      attempts += 1;
      const latest = await this.getLatestDeploymentStatus(options.projectId);
      lastStatus = latest;
      const isNewDeployment = previousId ? latest.deploymentId !== previousId : false;

      if (requireNewDeployment) {
        if (isNewDeployment && latest.status !== "BUILDING") {
          return {
            ...latest,
            previousDeploymentId: previousId,
            isNewDeployment,
            attempts
          };
        }
      } else if (latest.status !== "BUILDING") {
        return {
          ...latest,
          previousDeploymentId: previousId,
          isNewDeployment,
          attempts
        };
      }

      await sleep(pollIntervalMs);
    }

    const statusMessage = lastStatus
      ? `last deployment ${lastStatus.deploymentId} is ${lastStatus.status}`
      : "no deployment status was retrieved";
    throw new AppError(`Timed out waiting for deployment update: ${statusMessage}`, 504);
  }
};
