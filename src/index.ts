/**
 * Entry point for the recall-meeting-info server.
 *
 * Sets up Express middleware, mounts the API router, and starts listening.
 * Keep this file thin — it wires pieces together but contains no business logic.
 */
import express from "express";
import swaggerUi from "swagger-ui-express";
import { SwaggerTheme, SwaggerThemeNameEnum } from "swagger-themes";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { PORT } from "./config";
import { apiRouter } from "./routes";
import { logger } from "./utils/logger";

const openapiSpec = yaml.load(
  readFileSync(join(__dirname, "../openapi.yaml"), "utf8")
) as object;

const theme = new SwaggerTheme();

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (req.path === "/api/webhooks/recall") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// ---------------------------------------------------------------------------
// API docs
// ---------------------------------------------------------------------------
// Interactive OpenAPI docs — http://localhost:3000/api-docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customCss: theme.getBuffer(SwaggerThemeNameEnum.DARK) + `
    .swagger-ui .topbar { display: none; }
  `,
}));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/api", apiRouter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
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
    api_docs:       `GET  /api-docs`,
    health:         `GET  /health`,
    create_meeting: `POST /api/meetings`,
    list_meetings:  `GET  /api/meetings`,
    get_meeting:    `GET  /api/meetings/:bot_id`,
    get_transcript: `GET  /api/meetings/:bot_id/transcript`,
    get_insights:   `GET  /api/meetings/:bot_id/insights`,
    process:        `POST /api/meetings/:bot_id/process`,
    webhook:        `POST /api/webhooks/recall`,
  });
});

export default app;
