/**
 * Webhooks router.
 *
 * Receives lifecycle event POSTs from Recall.ai and dispatches them to
 * the bot event handler. Responds immediately with 200 so Recall.ai is
 * not held waiting while we process (which can take several seconds for
 * transcript fetching and AI calls).
 *
 * Webhook verification ensures that only genuine Recall.ai requests are
 * processed. Any request that fails verification is rejected with 401.
 *
 * To register this endpoint with Recall.ai:
 *   Dashboard → Webhooks → Add Endpoint → https://your-domain/api/webhooks/recall
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { RECALL_WEBHOOK_SECRET } from "../config";
import { handleBotEvent } from "../handlers/botEventHandler";
import { RecallWebhookPayload } from "../types";
import { logger } from "../utils/logger";

export const webhooksRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/webhooks/recall
// ---------------------------------------------------------------------------

/**
 * Receives and processes Recall.ai bot lifecycle events.
 *
 * Verification: Recall.ai signs each request with an HMAC-SHA256 signature
 * derived from the raw request body and the workspace verification secret.
 * We recompute the signature and reject any request where it does not match.
 *
 * Processing: Responds 200 immediately, then processes the event asynchronously
 * to avoid Recall.ai timing out the webhook delivery.
 */
webhooksRouter.post(
  "/recall",
  (req: Request, res: Response) => {
    // --- Step 1: Verify the request is genuinely from Recall.ai ---
    const signature = (req.headers["svix-signature"] ?? req.headers["webhook-signature"]) as string | undefined;
    const msgId = (req.headers["svix-id"] ?? req.headers["webhook-id"]) as string | undefined;
    const msgTimestamp = (req.headers["svix-timestamp"] ?? req.headers["webhook-timestamp"]) as string | undefined;

    if (!signature || !msgId || !msgTimestamp) {
      logger.warn("Webhook request missing Svix signature headers");
      return res.status(401).json({ error: "Missing signature headers" });
    }

    const isValid = verifyWebhookSignature({
      rawBody: req.body as Buffer,
      signature,
      msgId,
      msgTimestamp,
      secret: RECALL_WEBHOOK_SECRET,
    });

    if (!isValid) {
      logger.warn("Webhook signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // --- Step 2: Acknowledge receipt immediately ---
    // Recall.ai requires a 2xx response within 15 seconds. We respond now
    // and process the event asynchronously to avoid timeouts on heavy operations
    // like transcript downloading and LLM processing.
    res.status(200).json({ received: true });

    // --- Step 3: Process the event in the background ---
    const payload = JSON.parse((req.body as Buffer).toString()) as RecallWebhookPayload;

    handleBotEvent(payload).catch((err) => {
      logger.error("Unhandled error in bot event handler", {
        event: payload.event,
        bot_id: payload.data.bot.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
);

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

interface VerifySignatureParams {
  rawBody: Buffer;
  signature: string;
  msgId: string;
  msgTimestamp: string;
  secret: string;
}

/**
 * Verifies a Recall.ai webhook request using HMAC-SHA256.
 *
 * Recall.ai uses the Svix webhook delivery system. The signed content is:
 *   "{msgId}.{msgTimestamp}.{rawBodyString}"
 *
 * The secret is base64-encoded with a "whsec_" prefix that must be stripped
 * before decoding.
 *
 * @param params - Headers and body needed to reconstruct the signature.
 * @returns true if the signature matches, false otherwise.
 */
function verifyWebhookSignature(params: VerifySignatureParams): boolean {
  try {
    const { rawBody, signature, msgId, msgTimestamp, secret } = params;

    // Strip the "whsec_" prefix and decode the base64 secret.
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");

    // Reconstruct the signed content string.
    const signedContent = `${msgId}.${msgTimestamp}.${rawBody.toString()}`;

    // Compute HMAC-SHA256.
    const computed = crypto
      .createHmac("sha256", secretBytes)
      .update(signedContent)
      .digest("base64");

    // The Svix signature header may contain multiple space-separated "vN,<sig>" entries.
    // We check if any of them match our computed value.
    const signatures = signature.split(" ");
    return signatures.some((sig) => {
      const [, sigValue] = sig.split(",");
      return sigValue && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sigValue));
    });
  } catch (err) {
    logger.error("Error during webhook signature verification", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
