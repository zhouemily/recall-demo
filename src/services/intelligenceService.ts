/**
 * Intelligence service.
 *
 * When ANTHROPIC_API_KEY is set, uses Claude to generate a proper meeting
 * summary, action items, and key decisions from the transcript.
 *
 * Falls back to local keyword-based heuristics when no API key is present,
 * so the server remains fully functional without an AI dependency.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TranscriptEntry, MeetingInsights, ActionItem } from "../types";
import { formatTranscriptForPrompt, extractParticipants } from "./transcriptService";
import { logger } from "../utils/logger";
import { ANTHROPIC_API_KEY } from "../config";

// ---------------------------------------------------------------------------
// Keyword lists (used by the heuristic fallback only)
// ---------------------------------------------------------------------------

const ACTION_KEYWORDS = [
  "will ", "i'll ", "we'll ", "going to ", "need to ", "should ",
  "let's ", "let me ", "i'll make sure", "i will ", "we will ",
  "follow up", "follow-up", "action item", "take care of", "handle ",
  "schedule ", "send ", "create ", "set up ", "reach out",
];

const DECISION_KEYWORDS = [
  "decided", "agreed", "going with", "we'll go with", "confirmed",
  "approved", "finalized", "finalised", "settled on", "chosen",
  "we're going to", "the plan is", "we've decided", "resolution",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates structured meeting insights from a normalised transcript.
 * Uses Claude when ANTHROPIC_API_KEY is configured; falls back to heuristics.
 */
export async function generateInsights(transcript: TranscriptEntry[]): Promise<MeetingInsights> {
  if (ANTHROPIC_API_KEY) {
    logger.info("Generating meeting insights via Claude", {
      transcript_entries: transcript.length,
    });
    return generateInsightsWithClaude(transcript);
  }

  logger.info("ANTHROPIC_API_KEY not set — using local heuristics", {
    transcript_entries: transcript.length,
  });
  return generateInsightsLocally(transcript);
}

// ---------------------------------------------------------------------------
// Claude-powered implementation
// ---------------------------------------------------------------------------

async function generateInsightsWithClaude(transcript: TranscriptEntry[]): Promise<MeetingInsights> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY! });
  const participants = extractParticipants(transcript);
  const transcriptText = formatTranscriptForPrompt(transcript);

  const prompt = `You are an expert meeting analyst. Analyse this meeting transcript and return a JSON object with the following fields:

- "summary": A concise 2-4 sentence paragraph summarising what the meeting was about, the main topics discussed, and any outcomes. Write it as a professional business summary.
- "action_items": An array of objects with "task" (string) and "owner" (string | null). Extract concrete tasks, commitments, and follow-ups. Owner should be the person who committed to the action, or null if unclear.
- "key_decisions": An array of strings. Each string is one clear decision that was made or agreed upon during the meeting.
- "participants": An array of participant name strings.

Return ONLY valid JSON with no markdown, no code fences, no extra text.

Participants identified: ${participants.join(", ") || "unknown"}

Transcript:
${transcriptText}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  let parsed: MeetingInsights;
  try {
    parsed = JSON.parse(content.text) as MeetingInsights;
  } catch {
    logger.error("Failed to parse Claude response as JSON", { raw: content.text });
    throw new Error("Claude returned invalid JSON");
  }

  logger.info("Claude insights generated successfully", {
    action_items: parsed.action_items?.length ?? 0,
    key_decisions: parsed.key_decisions?.length ?? 0,
  });

  return {
    summary: parsed.summary ?? "",
    action_items: parsed.action_items ?? [],
    key_decisions: parsed.key_decisions ?? [],
    participants: parsed.participants ?? participants,
  };
}

// ---------------------------------------------------------------------------
// Local heuristic fallback
// ---------------------------------------------------------------------------

async function generateInsightsLocally(transcript: TranscriptEntry[]): Promise<MeetingInsights> {
  const participants = extractParticipants(transcript);
  const action_items = extractActionItems(transcript);
  const key_decisions = extractKeyDecisions(transcript);
  const summary = buildSummary(transcript, participants);

  logger.info("Heuristic insights generated", {
    action_items: action_items.length,
    key_decisions: key_decisions.length,
    participants: participants.length,
  });

  return { summary, action_items, key_decisions, participants };
}

function buildSummary(transcript: TranscriptEntry[], participants: string[]): string {
  if (transcript.length === 0) return "No transcript content was available to summarise.";

  const duration = transcript[transcript.length - 1].end_time - transcript[0].start_time;
  const minutes = Math.round(duration / 60);
  const durationStr = minutes <= 1 ? "under a minute" : `approximately ${minutes} minute${minutes !== 1 ? "s" : ""}`;

  const participantStr =
    participants.length === 0
      ? "unknown participants"
      : participants.length === 1
      ? participants[0]
      : `${participants.slice(0, -1).join(", ")} and ${participants[participants.length - 1]}`;

  const firstUtterances: string[] = [];
  const seen = new Set<string>();
  for (const entry of transcript) {
    const speaker = entry.speaker ?? "Unknown";
    if (!seen.has(speaker) && entry.words.length > 5) {
      firstUtterances.push(`${speaker} opened with: "${entry.text}"`);
      seen.add(speaker);
    }
  }

  return (
    `The meeting involved ${participantStr} and ran for ${durationStr}.` +
    (firstUtterances.length > 0 ? " " + firstUtterances.join(". ") + "." : "") +
    ` The conversation covered ${transcript.length} utterances in total.`
  );
}

function extractActionItems(transcript: TranscriptEntry[]): ActionItem[] {
  const items: ActionItem[] = [];
  const seen = new Set<string>();
  for (const entry of transcript) {
    const lower = entry.text.toLowerCase();
    const matched = ACTION_KEYWORDS.find((kw) => lower.includes(kw));
    if (!matched) continue;
    const sentence = extractSentenceAround(entry.text, matched);
    const key = sentence.toLowerCase().trim();
    if (seen.has(key) || sentence.split(" ").length < 4) continue;
    seen.add(key);
    items.push({ task: capitalise(sentence), owner: entry.speaker ?? null });
    if (items.length >= 10) break;
  }
  return items;
}

function extractKeyDecisions(transcript: TranscriptEntry[]): string[] {
  const decisions: string[] = [];
  const seen = new Set<string>();
  for (const entry of transcript) {
    const lower = entry.text.toLowerCase();
    const matched = DECISION_KEYWORDS.find((kw) => lower.includes(kw));
    if (!matched) continue;
    const sentence = extractSentenceAround(entry.text, matched);
    const key = sentence.toLowerCase().trim();
    if (seen.has(key) || sentence.split(" ").length < 4) continue;
    seen.add(key);
    const speaker = entry.speaker ? `${entry.speaker}: ` : "";
    decisions.push(capitalise(`${speaker}${sentence}`));
    if (decisions.length >= 10) break;
  }
  return decisions;
}

function extractSentenceAround(text: string, keyword: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const lower = keyword.toLowerCase();
  const match = sentences.find((s) => s.toLowerCase().includes(lower));
  return (match ?? text).trim();
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
