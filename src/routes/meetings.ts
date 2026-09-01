/**
 * Meetings router.
 *
 * Handles all /api/meetings endpoints. Each handler is kept thin —
 * request validation and response shaping happen here; all business
 * logic lives in the services and store.
 */

import { Router, Request, Response } from "express";
import axios from "axios";
import { createBot, getBotById } from "../services/recallClient";
import { fetchTranscript } from "../services/transcriptService";
import { generateInsights } from "../services/intelligenceService";
import { meetingStore } from "../store/meetingStore";
import { CreateMeetingRequest, ApiResponse, ApiErrorResponse, MeetingRecord } from "../types";
import { DEFAULT_BOT_NAME } from "../config";
import { logger } from "../utils/logger";

export const meetingsRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/meetings
// ---------------------------------------------------------------------------

/**
 * Sends a Recall.ai bot to a meeting URL and begins tracking the session.
 *
 * Body:
 *   - meeting_url (required): The full URL of the meeting to join.
 *   - bot_name (optional): Display name for the bot. Defaults to DEFAULT_BOT_NAME.
 *
 * Returns the created meeting record including the bot_id for subsequent lookups.
 */
meetingsRouter.post(
  "/",
  async (
    req: Request<{}, {}, CreateMeetingRequest>,
    res: Response<ApiResponse<MeetingRecord> | ApiErrorResponse>
  ) => {
    const { meeting_url, bot_name } = req.body;

    if (!meeting_url) {
      return res.status(400).json({ success: false, error: "meeting_url is required" });
    }

    try {
      const bot = await createBot({
        meeting_url,
        bot_name: bot_name ?? DEFAULT_BOT_NAME,
      });

      const now = new Date().toISOString();
      const record: MeetingRecord = {
        bot_id: bot.id,
        meeting_url,
        bot_name: bot_name ?? DEFAULT_BOT_NAME,
        status: "ready",
        created_at: now,
        updated_at: now,
        transcript: null,
        insights: null,
      };

      meetingStore.create(record);

      logger.info("Meeting started", { bot_id: bot.id, meeting_url });

      return res.status(201).json({ success: true, data: record });
    } catch (err) {
      // Log the full Recall.ai error response body if available so that API
      // rejections (4xx) surface their detail rather than a generic message.
      const recallError = axios.isAxiosError(err) ? err.response?.data : undefined;
      logger.error("Failed to create meeting bot", {
        error: err instanceof Error ? err.message : String(err),
        recall_response: recallError,
      });
      return res.status(502).json({
        success: false,
        error: "Failed to send bot to meeting. Check your meeting URL and try again.",
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/meetings
// ---------------------------------------------------------------------------

/**
 * Returns all tracked meetings, newest first.
 */
meetingsRouter.get(
  "/",
  (_req: Request, res: Response<ApiResponse<MeetingRecord[]>>) => {
    const meetings = meetingStore.getAll();
    return res.json({ success: true, data: meetings });
  }
);

// ---------------------------------------------------------------------------
// GET /api/meetings/:bot_id
// ---------------------------------------------------------------------------

/**
 * Returns the current status and metadata for a single meeting.
 *
 * Params:
 *   - bot_id: The Recall.ai bot UUID returned when the meeting was created.
 */
meetingsRouter.get(
  "/:bot_id",
  (
    req: Request<{ bot_id: string }>,
    res: Response<ApiResponse<MeetingRecord> | ApiErrorResponse>
  ) => {
    const { bot_id } = req.params;
    const record = meetingStore.get(bot_id);

    if (!record) {
      return res.status(404).json({ success: false, error: "Meeting not found" });
    }

    return res.json({ success: true, data: record });
  }
);

// ---------------------------------------------------------------------------
// GET /api/meetings/:bot_id/transcript
// ---------------------------------------------------------------------------

/**
 * Returns the full transcript for a completed meeting.
 *
 * Responds with 202 if the meeting is still in progress or processing.
 *
 * Params:
 *   - bot_id: The Recall.ai bot UUID.
 */
meetingsRouter.get(
  "/:bot_id/transcript",
  (
    req: Request<{ bot_id: string }>,
    res: Response<ApiResponse<MeetingRecord["transcript"]> | ApiErrorResponse>
  ) => {
    const { bot_id } = req.params;
    const record = meetingStore.get(bot_id);

    if (!record) {
      return res.status(404).json({ success: false, error: "Meeting not found" });
    }

    if (record.transcript === null) {
      return res
        .status(202)
        .json({ success: false, error: "Transcript not yet available. Check back after the meeting ends." });
    }

    return res.json({ success: true, data: record.transcript });
  }
);

// ---------------------------------------------------------------------------
// GET /api/meetings/:bot_id/insights
// ---------------------------------------------------------------------------

/**
 * Returns AI-generated insights for a completed meeting:
 * summary, action items, key decisions, and participant list.
 *
 * Responds with 202 if the meeting is still in progress or AI processing
 * has not yet completed.
 *
 * Params:
 *   - bot_id: The Recall.ai bot UUID.
 */
meetingsRouter.get(
  "/:bot_id/insights",
  (
    req: Request<{ bot_id: string }>,
    res: Response<ApiResponse<MeetingRecord["insights"]> | ApiErrorResponse>
  ) => {
    const { bot_id } = req.params;
    const record = meetingStore.get(bot_id);

    if (!record) {
      return res.status(404).json({ success: false, error: "Meeting not found" });
    }

    if (record.insights === null) {
      return res
        .status(202)
        .json({ success: false, error: "Insights not yet available. Processing begins when the meeting ends." });
    }

    return res.json({ success: true, data: record.insights });
  }
);

// ---------------------------------------------------------------------------
// POST /api/meetings/:bot_id/process
// ---------------------------------------------------------------------------

/**
 * Manually triggers transcript fetching and AI insight generation for a
 * completed meeting.
 *
 * This is useful in two situations:
 *   1. Webhook delivery was missed (e.g. the endpoint was not yet registered
 *      when the meeting ended) and the meeting record is stuck in a pre-done
 *      state with null transcript and insights.
 *   2. Processing failed during the webhook handler and needs to be retried.
 *
 * The endpoint is idempotent — calling it on an already-processed meeting
 * will re-fetch and overwrite the stored transcript and insights.
 *
 * Params:
 *   - bot_id: The Recall.ai bot UUID.
 */
meetingsRouter.post(
  "/:bot_id/process",
  async (
    req: Request<{ bot_id: string }>,
    res: Response<ApiResponse<MeetingRecord> | ApiErrorResponse>
  ) => {
    const { bot_id } = req.params;
    let record = meetingStore.get(bot_id);

    // If the meeting isn't in the local store (e.g. after a server restart),
    // attempt to re-import it from Recall.ai before processing.
    if (!record) {
      try {
        const bot = await getBotById(bot_id);
        const now = new Date().toISOString();
        const imported: MeetingRecord = {
          bot_id: bot.id,
          meeting_url: bot.meeting_url,
          bot_name: DEFAULT_BOT_NAME,
          status: "done",
          created_at: now,
          updated_at: now,
          transcript: null,
          insights: null,
        };
        meetingStore.create(imported);
        record = imported;
        logger.info("Re-imported meeting record from Recall.ai", { bot_id });
      } catch {
        return res.status(404).json({
          success: false,
          error: "Meeting not found locally and could not be retrieved from Recall.ai.",
        });
      }
    }

    try {
      logger.info("Manual processing triggered", { bot_id });

      const transcript = await fetchTranscript(bot_id);
      meetingStore.setTranscript(bot_id, transcript);

      const insights = await generateInsights(transcript);
      meetingStore.setInsights(bot_id, insights);
      meetingStore.updateStatus(bot_id, "done");

      const updated = meetingStore.get(bot_id)!;

      logger.info("Manual processing complete", {
        bot_id,
        transcript_entries: transcript.length,
        action_items: insights.action_items.length,
        key_decisions: insights.key_decisions.length,
      });

      return res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("Manual processing failed", {
        bot_id,
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(502).json({
        success: false,
        error: "Failed to process meeting. The recording may not be ready yet — try again in a moment.",
      });
    }
  }
);
