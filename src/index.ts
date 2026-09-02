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
import rateLimit from "express-rate-limit";
import { PORT } from "./config";
import { apiRouter } from "./routes";
import { logger } from "./utils/logger";

const openapiSpec = yaml.load(
  readFileSync(join(__dirname, "../openapi.yaml"), "utf8")
) as object;

const theme = new SwaggerTheme();
const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: "Too many requests, please try again later." }
});

app.use("/api", limiter);

app.use((req, res, next) => {
  if (req.path === "/api/webhooks/recall") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customCss: theme.getBuffer(SwaggerThemeNameEnum.DARK) + `
    .swagger-ui .topbar { display: none; }
  `,
}));

app.use("/api", apiRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime_seconds: Math.floor(process.uptime()) });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

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
  logger.info("Optional features:", {
    ai_insights: process.env.GEMINI_API_KEY ? "enabled (Gemini)" : "disabled (heuristics fallback)",
    slack_notifications: process.env.SLACK_WEBHOOK_URL ? "enabled" : "disabled",
  });
});

export default app;
