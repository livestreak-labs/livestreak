import { Router } from "express";
import { createTenancyController } from "../controllers/tenancy.js";

// --- exports ---

export const createTenancyRouter = (): Router => {
  const router = Router();
  const controller = createTenancyController();

  router.post(/^\/tenancy\/.+$/u, controller.stub);

  return router;
};
