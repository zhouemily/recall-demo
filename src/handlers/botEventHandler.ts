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
import axios from "axios";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

async function onBotDone(bot_id: string): Promise<void> {
  meetingStore.updateStatus(bot_id, "done");
  logger.info("Bot done — starting transcript and insights processing", { bot_id });
  try {
    const transcript = await fetchTranscript(bot_id);
    meetingStore.setTranscript(bot_id, transcript);
    const insights = await generateInsights(transcript);
    meetingStore.setInsights(bot_id, insights);
    logger.info("Processing complete", { bot_id });

    // Send Slack notification if webhook URL is configured
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackWebhookUrl) {
      const actionItems = insights.action_items
        .map((a: { task: string; owner: string }) => `• ${a.task} _(${a.owner})_`)
        .join("\n");

      await axios.post(slackWebhookUrl, {
        text: `*Meeting insights ready* 🎙️`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Meeting insights ready* 🎙️\n*Bot ID:* \`${bot_id}\`` }
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Summary*\n${insights.summary}` }
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Action items*\n${actionItems || "None"}` }
          }
        ]
      });
      logger.info("Slack notification sent", { bot_id });
    }
  } catch (err) {
    logger.error("Failed to process meeting data", {
      bot_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function onBotFatal(bot_id: string, sub_code: string | null): Promise<void> {
  meetingStore.updateStatus(bot_id, "fatal");
  logger.error("Bot encountered a fatal error", { bot_id, sub_code });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
