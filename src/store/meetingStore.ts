/**
 * In-memory meeting store.
 *
 * Tracks the state of every meeting bot dispatched in this server session.
 * This is intentionally an in-memory store to keep the demo dependency-free
 * (no database required to run it).
 *
 * --- Extending this ---
 * For a production deployment, swap this module for a persistent store
 * (Postgres, Redis, etc.) without changing any call sites — all access goes
 * through the exported `meetingStore` object.
 */

import { MeetingRecord, BotStatus, TranscriptEntry, MeetingInsights } from "../types";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

/** Internal map of bot_id → MeetingRecord. */
const store = new Map<string, MeetingRecord>();

export const meetingStore = {
  /**
   * Adds a new meeting record to the store.
   * Called immediately after the Recall.ai bot is created.
   *
   * @param record - The initial meeting record to persist.
   */
  create(record: MeetingRecord): void {
    store.set(record.bot_id, record);
    logger.debug("Meeting record created", { bot_id: record.bot_id });
  },

  /**
   * Returns the meeting record for the given bot ID, or undefined if not found.
   *
   * @param bot_id - The Recall.ai bot UUID.
   */
  get(bot_id: string): MeetingRecord | undefined {
    return store.get(bot_id);
  },

  /**
   * Returns all meeting records, ordered by creation time (newest first).
   */
  getAll(): MeetingRecord[] {
    return Array.from(store.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  /**
   * Updates the bot status on an existing record and stamps `updated_at`.
   * Silently no-ops if the bot_id is not in the store.
   *
   * @param bot_id - The Recall.ai bot UUID.
   * @param status - The new bot status to set.
   */
  updateStatus(bot_id: string, status: BotStatus): void {
    const record = store.get(bot_id);
    if (!record) {
      logger.warn("updateStatus called for unknown bot_id", { bot_id, status });
      return;
    }
    record.status = status;
    record.updated_at = new Date().toISOString();
    logger.debug("Meeting status updated", { bot_id, status });
  },

  /**
   * Stores the normalised transcript for a completed meeting.
   *
   * @param bot_id - The Recall.ai bot UUID.
   * @param transcript - Array of normalised transcript entries.
   */
  setTranscript(bot_id: string, transcript: TranscriptEntry[]): void {
    const record = store.get(bot_id);
    if (!record) {
      logger.warn("setTranscript called for unknown bot_id", { bot_id });
      return;
    }
    record.transcript = transcript;
    record.updated_at = new Date().toISOString();
  },

  /**
   * Stores the AI-generated insights for a completed meeting.
   *
   * @param bot_id - The Recall.ai bot UUID.
   * @param insights - Structured insights from the intelligence service.
   */
  setInsights(bot_id: string, insights: MeetingInsights): void {
    const record = store.get(bot_id);
    if (!record) {
      logger.warn("setInsights called for unknown bot_id", { bot_id });
      return;
    }
    record.insights = insights;
    record.updated_at = new Date().toISOString();
  },
};
