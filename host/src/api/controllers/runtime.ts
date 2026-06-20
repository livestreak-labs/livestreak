import { serializeLiveStreakError } from "@livestreak/core";
import type { Request, Response } from "express";
import { runtimeNotEnabled } from "../../services/runtime.js";

// --- exports ---

export const createRuntimeController = () => ({
  stub: (_req: Request, res: Response): void => {
    const error = runtimeNotEnabled();
    res.status(501).json({ error: serializeLiveStreakError(error) });
  }
});
