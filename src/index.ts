/**
 * Entry point for the recall-meeting-info server.
 *
 * Sets up Express middleware, mounts the API router, and starts listening.
 * Keep this file thin — it wires pieces together but contains no business logic.
 */

import express from "express";
import { PORT } from "./config";
import { apiRouter } from "./routes";
import { logger } from "./utils/logger";

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Parse incoming JSON bodies for all routes except /api/webhooks/recall,
// which needs the raw Buffer for HMAC signature verification.
app.use((req, res, next) => {
  if (req.path === "/api/webhooks/recall") {
    // Preserve raw body so the webhook handler can recompute the HMAC signature.
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use("/api", apiRouter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Simple liveness probe. Returns 200 with server uptime.
 * Useful for load balancers, container orchestrators, and quick smoke tests.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime_seconds: Math.floor(process.uptime()) });
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  logger.info(`recall-meeting-info server running`, { port: PORT });
  logger.info("Available endpoints:", {
    health: `GET  /health`,
    create_meeting: `POST /api/meetings`,
    list_meetings: `GET  /api/meetings`,
    get_meeting: `GET  /api/meetings/:bot_id`,
    get_transcript: `GET  /api/meetings/:bot_id/transcript`,
    get_insights: `GET  /api/meetings/:bot_id/insights`,
    webhook: `POST /api/webhooks/recall`,
  });
});

export default app;
