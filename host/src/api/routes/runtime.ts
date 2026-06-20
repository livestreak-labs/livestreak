import { Router } from "express";
import { createRuntimeController } from "../controllers/runtime.js";

// --- exports ---

export const createRuntimeRouter = (): Router => {
  const router = Router();
  const controller = createRuntimeController();

  router.post(/^\/runtime\/.+$/u, controller.stub);

  return router;
};
