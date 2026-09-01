/**
 * Route aggregator.
 *
 * Mounts all routers onto their path prefixes. Adding a new feature area
 * means creating a new router file and registering it here — nothing else
 * needs to change in the server setup.
 */

import { Router } from "express";
import { meetingsRouter } from "./meetings";
import { webhooksRouter } from "./webhooks";

export const apiRouter = Router();

apiRouter.use("/meetings", meetingsRouter);
apiRouter.use("/webhooks", webhooksRouter);
