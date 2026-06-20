import { serializeLiveStreakError } from "@livestreak/core";
import type { Request, Response } from "express";
import { tenancyNotEnabled } from "../../services/tenancy.js";

// --- exports ---

export const createTenancyController = () => ({
  stub: (_req: Request, res: Response): void => {
    const error = tenancyNotEnabled();
    res.status(501).json({ error: serializeLiveStreakError(error) });
  }
});
