/**
 * Transcript service.
 *
 * Responsible for fetching the raw transcript from Recall.ai and normalising
 * it into the clean TranscriptEntry format used throughout this application.
 *
 * Keeping normalisation here means that if Recall.ai's transcript schema
 * changes, only this file needs to be updated — the rest of the app stays
 * untouched.
 */

import { getBotById, downloadFromUrl } from "./recallClient";
import { TranscriptEntry, RawRecallTranscript } from "../types";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches and normalises the transcript for a completed bot recording.
 *
 * Looks up the bot to get the transcript download URL from its
 * media_shortcuts, downloads the raw JSON, and returns a normalised array
 * of TranscriptEntry objects with a pre-joined `text` field for convenience.
 *
 * @param bot_id - The UUID of the completed bot.
 * @returns Array of normalised transcript entries, ordered by start time.
 * @throws If the bot has no recording, no transcript URL, or the download fails.
 */
export async function fetchTranscript(bot_id: string): Promise<TranscriptEntry[]> {
  logger.info("Fetching transcript", { bot_id });

  const bot = await getBotById(bot_id);
  const recording = bot.recordings?.[0];

  if (!recording) {
    throw new Error(`No recording found for bot ${bot_id}`);
  }

  const transcriptDownloadUrl = recording.media_shortcuts?.transcript?.data?.download_url;

  if (!transcriptDownloadUrl) {
    throw new Error(`Transcript not yet available for bot ${bot_id}`);
  }

  const raw = await downloadFromUrl<RawRecallTranscript>(transcriptDownloadUrl);

  const normalised = normaliseTranscript(raw);
  logger.info("Transcript fetched and normalised", {
    bot_id,
    entry_count: normalised.length,
  });

  return normalised;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw Recall.ai transcript payload into the clean TranscriptEntry
 * format. Maps participant.name → speaker, derives start/end times from the
 * word-level timestamps, and joins word tokens into a single `text` string.
 *
 * @param raw - The raw transcript array downloaded from Recall.ai.
 * @returns Normalised, ordered array of transcript entries.
 */
function normaliseTranscript(raw: RawRecallTranscript): TranscriptEntry[] {
  const entries = Array.isArray(raw) ? raw : [];

  return entries
    .map((entry) => {
      const words = entry.words ?? [];
      const text = entry.text ?? words.map((w) => w.text).join(" ").trim();

      // Derive start/end from word timestamps (relative seconds from call start).
      const start_time = words[0]?.start_timestamp?.relative ?? 0;
      const end_time = words[words.length - 1]?.end_timestamp?.relative ?? start_time;

      // Recall.ai returns speaker name under participant.name in newer transcript formats.
      const speaker =
        entry.speaker ??
        entry.participant?.name ??
        null;

      return {
        speaker,
        speaker_id: entry.speaker_id ?? entry.participant?.id?.toString() ?? null,
        words,
        start_time,
        end_time,
        text,
      };
    })
    .filter((entry) => entry.text.length > 0)
    .sort((a, b) => a.start_time - b.start_time);
}

/**
 * Formats a transcript array into a plain-text block suitable for passing
 * to an LLM prompt. Each line is: "SpeakerName: utterance text"
 *
 * @param transcript - Normalised array of transcript entries.
 * @returns A single multi-line string representing the full conversation.
 */
export function formatTranscriptForPrompt(transcript: TranscriptEntry[]): string {
  return transcript
    .map((entry) => {
      const speaker = entry.speaker ?? "Unknown Speaker";
      return `${speaker}: ${entry.text}`;
    })
    .join("\n");
}

/**
 * Extracts a deduplicated list of speaker names from a transcript.
 *
 * @param transcript - Normalised array of transcript entries.
 * @returns Sorted array of unique speaker names.
 */
export function extractParticipants(transcript: TranscriptEntry[]): string[] {
  const names = new Set(
    transcript
      .map((entry) => entry.speaker)
      .filter((name): name is string => name != null && name.length > 0)
  );
  return Array.from(names).sort();
}
