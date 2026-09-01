/**
 * Intelligence service.
 *
 * Processes a meeting transcript locally to extract structured insights:
 * a summary, action items, and key decisions — no external AI API required.
 *
 * Uses keyword-based heuristics to identify action items and decisions from
 * the transcript text. This approach is fast, free, and works offline.
 * It can be swapped for an LLM-backed implementation without changing any
 * other part of the application.
 */

import { TranscriptEntry, MeetingInsights, ActionItem } from "../types";
import { formatTranscriptForPrompt, extractParticipants } from "./transcriptService";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Keyword lists
// ---------------------------------------------------------------------------

/** Phrases that suggest an upcoming action or commitment. */
const ACTION_KEYWORDS = [
  "will ", "i'll ", "we'll ", "going to ", "need to ", "should ",
  "let's ", "let me ", "i'll make sure", "i will ", "we will ",
  "follow up", "follow-up", "action item", "take care of", "handle ",
  "schedule ", "send ", "create ", "set up ", "reach out",
];

/** Phrases that suggest a decision was reached. */
const DECISION_KEYWORDS = [
  "decided", "agreed", "going with", "we'll go with", "confirmed",
  "approved", "finalized", "finalised", "settled on", "chosen",
  "we're going to", "the plan is", "we've decided", "resolution",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates structured meeting insights from a normalised transcript
 * using local keyword-based heuristics.
 *
 * @param transcript - Normalised array of transcript entries from the meeting.
 * @returns Structured insights: summary, action items, key decisions, participants.
 */
export async function generateInsights(transcript: TranscriptEntry[]): Promise<MeetingInsights> {
  logger.info("Generating meeting insights (local heuristics)", {
    transcript_entries: transcript.length,
  });

  const participants = extractParticipants(transcript);
  const action_items = extractActionItems(transcript);
  const key_decisions = extractKeyDecisions(transcript);
  const summary = buildSummary(transcript, participants);

  logger.info("Insights generated successfully", {
    action_items: action_items.length,
    key_decisions: key_decisions.length,
    participants: participants.length,
  });

  return { summary, action_items, key_decisions, participants };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a plain-text summary of the meeting.
 *
 * Reports who spoke, roughly how long the meeting ran, and the first
 * substantive thing each participant said — a lightweight but real signal
 * of what was discussed.
 */
function buildSummary(transcript: TranscriptEntry[], participants: string[]): string {
  if (transcript.length === 0) {
    return "No transcript content was available to summarise.";
  }

  const duration = transcript[transcript.length - 1].end_time - transcript[0].start_time;
  const minutes = Math.round(duration / 60);
  const durationStr = minutes <= 1 ? "under a minute" : `approximately ${minutes} minute${minutes !== 1 ? "s" : ""}`;

  const participantStr =
    participants.length === 0
      ? "unknown participants"
      : participants.length === 1
      ? participants[0]
      : `${participants.slice(0, -1).join(", ")} and ${participants[participants.length - 1]}`;

  // Collect the first substantive utterance (>5 words) per speaker.
  const firstUtterances: string[] = [];
  const seen = new Set<string>();
  for (const entry of transcript) {
    const speaker = entry.speaker ?? "Unknown";
    if (!seen.has(speaker) && entry.words.length > 5) {
      firstUtterances.push(`${speaker} opened with: "${entry.text}"`);
      seen.add(speaker);
    }
  }

  const utteranceSummary =
    firstUtterances.length > 0
      ? " " + firstUtterances.join(". ") + "."
      : "";

  return (
    `The meeting involved ${participantStr} and ran for ${durationStr}.` +
    utteranceSummary +
    ` The conversation covered ${transcript.length} utterances in total.`
  );
}

/**
 * Scans each utterance for action-item language and returns deduplicated results.
 * Caps at 10 items to keep the output focused.
 */
function extractActionItems(transcript: TranscriptEntry[]): ActionItem[] {
  const items: ActionItem[] = [];
  const seen = new Set<string>();

  for (const entry of transcript) {
    const lower = entry.text.toLowerCase();
    const matchedKeyword = ACTION_KEYWORDS.find((kw) => lower.includes(kw));
    if (!matchedKeyword) continue;

    // Trim to a single sentence around the keyword match.
    const sentence = extractSentenceAround(entry.text, matchedKeyword);
    const key = sentence.toLowerCase().trim();
    if (seen.has(key) || sentence.split(" ").length < 4) continue;

    seen.add(key);
    items.push({
      task: capitalise(sentence),
      owner: entry.speaker ?? null,
    });

    if (items.length >= 10) break;
  }

  return items;
}

/**
 * Scans each utterance for decision language and returns deduplicated strings.
 * Caps at 10 decisions.
 */
function extractKeyDecisions(transcript: TranscriptEntry[]): string[] {
  const decisions: string[] = [];
  const seen = new Set<string>();

  for (const entry of transcript) {
    const lower = entry.text.toLowerCase();
    const matchedKeyword = DECISION_KEYWORDS.find((kw) => lower.includes(kw));
    if (!matchedKeyword) continue;

    const sentence = extractSentenceAround(entry.text, matchedKeyword);
    const key = sentence.toLowerCase().trim();
    if (seen.has(key) || sentence.split(" ").length < 4) continue;

    seen.add(key);
    const speaker = entry.speaker ? `${entry.speaker}: ` : "";
    decisions.push(capitalise(`${speaker}${sentence}`));

    if (decisions.length >= 10) break;
  }

  return decisions;
}

/**
 * Extracts the sentence in `text` that contains `keyword` (case-insensitive).
 * Falls back to the full text if sentence splitting doesn't isolate it.
 */
function extractSentenceAround(text: string, keyword: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const lower = keyword.toLowerCase();
  const match = sentences.find((s) => s.toLowerCase().includes(lower));
  return (match ?? text).trim();
}

/** Uppercases the first character of a string. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
