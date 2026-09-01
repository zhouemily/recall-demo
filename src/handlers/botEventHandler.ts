/**
 * Bot event handler.
 *
 * Routes incoming Recall.ai webhook events to the appropriate action.
 * The webhook route calls handleBotEvent() and this module decides what
 * to do based on the event name — keeping routing logic out of the route
 * layer and processing logic out of the services.
 *
 * To add handling for a new event type, add a case to the switch statement
 * and implement a dedicated handler function below.
 */

import { RecallWebhookPayload, BotEventName } from "../types";
import { meetingStore } from "../store/meetingStore";
import { fetchTranscript } from "../services/transcriptService";
import { generateInsights } from "../services/intelligenceService";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Processes a single Recall.ai bot lifecycle event.
 *
 * This function is intentionally async — on the `bot.done` event it triggers
 * transcript fetching and AI processing, which take several seconds. The
 * webhook route responds immediately with 200 and lets this run in the
 * background so Recall.ai is not kept waiting.
 *
 * @param payload - The validated webhook payload from Recall.ai.
 */
export async function handleBotEvent(payload: RecallWebhookPayload): Promise<void> {
  const { event, data } = payload;
  const bot_id = data.bot.id;

  logger.info("Bot event received", { event, bot_id });

  switch (event) {
    case "bot.joining_call":
      await onBotJoiningCall(bot_id);
      break;

    case "bot.in_call_recording":
      await onBotRecording(bot_id);
      break;

    case "bot.done":
      await onBotDone(bot_id);
      break;

    case "bot.fatal":
      await onBotFatal(bot_id, data.data.sub_code);
      break;

    // Informational events — update status but take no further action.
    case "bot.in_waiting_room":
    case "bot.in_call_not_recording":
    case "bot.recording_permission_allowed":
    case "bot.recording_permission_denied":
    case "bot.call_ended":
      meetingStore.updateStatus(bot_id, eventNameToStatus(event));
      break;

    default:
      logger.debug("Received unrecognised bot event", { event, bot_id });
  }
}

// ---------------------------------------------------------------------------
// Event-specific handlers
// ---------------------------------------------------------------------------

async function onBotJoiningCall(bot_id: string): Promise<void> {
  meetingStore.updateStatus(bot_id, "joining_call");
}

async function onBotRecording(bot_id: string): Promise<void> {
  meetingStore.updateStatus(bot_id, "in_call_recording");
  logger.info("Bot is now recording", { bot_id });
}

/**
 * Triggered when the bot finishes and media is available for download.
 *
 * Fetches the transcript from Recall.ai, runs it through the intelligence
 * service to generate insights, and stores both on the meeting record.
 * Errors are caught and logged so that a processing failure does not cause
 * the webhook to return a non-2xx status (which would trigger Recall retries).
 */
async function onBotDone(bot_id: string): Promise<void> {
  meetingStore.updateStatus(bot_id, "done");
  logger.info("Bot done — starting transcript and insights processing", { bot_id });

  try {
    const transcript = await fetchTranscript(bot_id);
    meetingStore.setTranscript(bot_id, transcript);

    const insights = await generateInsights(transcript);
    meetingStore.setInsights(bot_id, insights);

    logger.info("Processing complete", { bot_id });
  } catch (err) {
    logger.error("Failed to process meeting data", {
      bot_id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Status stays "done" — the recording exists even if AI processing failed.
    // Callers will see null transcript/insights and can retry via the API.
  }
}

async function onBotFatal(bot_id: string, sub_code: string | null): Promise<void> {
  meetingStore.updateStatus(bot_id, "fatal");
  logger.error("Bot encountered a fatal error", { bot_id, sub_code });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a webhook event name to the corresponding BotStatus string.
 * Used for the informational events that only require a status update.
 */
function eventNameToStatus(event: BotEventName) {
  const map: Partial<Record<BotEventName, import("../types").BotStatus>> = {
    "bot.joining_call": "joining_call",
    "bot.in_waiting_room": "in_waiting_room",
    "bot.in_call_not_recording": "in_call_not_recording",
    "bot.in_call_recording": "in_call_recording",
    "bot.call_ended": "call_ended",
    "bot.done": "done",
    "bot.fatal": "fatal",
  };
  return map[event] ?? "joining_call";
}
