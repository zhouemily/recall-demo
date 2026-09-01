/**
 * Recall.ai API client.
 *
 * All HTTP calls to the Recall.ai REST API are made through this module.
 * No other file in the codebase calls Recall.ai directly — this keeps the
 * integration surface in one place so that API changes only require edits here.
 *
 * Docs: https://docs.recall.ai/reference
 */

import axios, { AxiosInstance } from "axios";
import { RECALL_API_KEY, RECALL_BASE_URL } from "../config";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Recall.ai response shapes
// ---------------------------------------------------------------------------

/** Shape of the bot object returned by the Create Bot endpoint. */
export interface RecallBot {
  id: string;
  meeting_url: string;
  status_changes: Array<{
    code: string;
    sub_code: string | null;
    created_at: string;
  }>;
  recordings: RecallRecording[];
}

/** A recording object nested inside a bot response. */
export interface RecallRecording {
  id: string;
  started_at: string | null;
  completed_at: string | null;
  media_shortcuts: {
    transcript: {
      data: {
        download_url: string | null;
      } | null;
    } | null;
    video_mixed: {
      data: {
        download_url: string | null;
      } | null;
    } | null;
    audio_mixed: {
      data: {
        download_url: string | null;
      } | null;
    } | null;
  } | null;
}

/** Parameters accepted by the Create Bot endpoint. */
export interface CreateBotParams {
  meeting_url: string;
  bot_name: string;
}

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------

/**
 * Shared Axios instance pre-configured with the Recall.ai base URL and
 * Authorization header. Re-use this instance for all requests so that
 * connection pooling and default headers are applied consistently.
 */
const recallHttp: AxiosInstance = axios.create({
  baseURL: RECALL_BASE_URL,
  headers: {
    Authorization: `Token ${RECALL_API_KEY}`,
    "Content-Type": "application/json",
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends a bot to the given meeting URL.
 *
 * Transcription is configured to use Recall.ai's built-in provider so that
 * no additional third-party transcription credentials are required.
 *
 * @param params - Meeting URL and display name for the bot.
 * @returns The created bot object, including its ID for subsequent lookups.
 * @throws If the Recall.ai API returns a non-2xx response.
 */
export async function createBot(params: CreateBotParams): Promise<RecallBot> {
  logger.info("Creating Recall.ai bot", { meeting_url: params.meeting_url });

  const response = await recallHttp.post<RecallBot>("/bot/", {
    meeting_url: params.meeting_url,
    bot_name: params.bot_name,
    recording_config: {
      transcript: {
        provider: {
          // recallai_streaming is Recall.ai's built-in transcription provider.
          // No additional third-party credentials are required.
          recallai_streaming: {},
        },
      },
    },
  });

  logger.info("Bot created successfully", { bot_id: response.data.id });
  return response.data;
}

/**
 * Retrieves the current state of a bot by its ID.
 *
 * Use this to check status and, once the bot is done, to access the
 * media_shortcuts URLs for transcript and recording downloads.
 *
 * Note: Do not poll this endpoint in a tight loop. Use webhook events to
 * react to status changes, and call this only when you need the full object.
 *
 * @param bot_id - The UUID of the bot to retrieve.
 * @returns The full bot object with current status and any completed recordings.
 * @throws If the Recall.ai API returns a non-2xx response.
 */
export async function getBotById(bot_id: string): Promise<RecallBot> {
  logger.debug("Fetching bot from Recall.ai", { bot_id });

  const response = await recallHttp.get<RecallBot>(`/bot/${bot_id}/`);
  return response.data;
}

/**
 * Downloads raw content from a Recall.ai presigned URL.
 *
 * Recall returns time-limited presigned URLs for media files (transcripts,
 * recordings). This helper fetches the content of those URLs and returns
 * the parsed JSON or raw text.
 *
 * @param download_url - The presigned URL returned by Recall.ai.
 * @returns The parsed response data.
 * @throws If the download request fails.
 */
export async function downloadFromUrl<T>(download_url: string): Promise<T> {
  logger.debug("Downloading media from presigned URL");

  // Use a plain axios call (no auth headers) since presigned URLs are self-authenticating.
  const response = await axios.get<T>(download_url);
  return response.data;
}
