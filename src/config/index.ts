/**
 * Centralised configuration module.
 *
 * All environment variables are read, validated, and exported from here.
 * Nothing else in the codebase reads from process.env directly — this
 * keeps the surface area for misconfiguration small and easy to audit.
 */

import dotenv from "dotenv";

dotenv.config();

/**
 * Reads a required environment variable. Throws at startup if it is missing
 * so that the server fails fast with a clear error rather than silently
 * misbehaving at request time.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Recall.ai
// ---------------------------------------------------------------------------

/** The Recall.ai region slug used to build the base URL (e.g. "us-west-2"). */
export const RECALL_REGION = requireEnv("RECALL_REGION");

/** Recall.ai REST API base URL, derived from the configured region. */
export const RECALL_BASE_URL = `https://${RECALL_REGION}.recall.ai/api/v1`;

/** Recall.ai API key — used in the Authorization header for all API calls. */
export const RECALL_API_KEY = requireEnv("RECALL_API_KEY");

/**
 * Recall.ai webhook verification secret.
 * Used to verify that inbound webhook requests are genuinely from Recall.ai.
 */
export const RECALL_WEBHOOK_SECRET = requireEnv("RECALL_WEBHOOK_SECRET");

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** HTTP port the Express server listens on. Defaults to 3000. */
export const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ---------------------------------------------------------------------------
// Bot defaults
// ---------------------------------------------------------------------------

/** Default display name shown in the meeting for the bot. */
export const DEFAULT_BOT_NAME = "Meeting Notetaker";

// ---------------------------------------------------------------------------
// Google Gemini (optional — enables AI-powered insights)
// ---------------------------------------------------------------------------

/**
 * Google Gemini API key for AI-powered meeting insights.
 * If not set, the intelligence service falls back to local heuristics.
 */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? null;
