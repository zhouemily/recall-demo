/**
 * Shared TypeScript interfaces for the recall-meeting-info API.
 *
 * All types that cross service/handler/route boundaries live here so that
 * naming is consistent throughout the codebase. If you extend the app, add
 * new types here rather than defining them inline in a service file.
 */

// ---------------------------------------------------------------------------
// Recall.ai Bot types
// ---------------------------------------------------------------------------

/** Status codes emitted by Recall.ai as a bot moves through its lifecycle. */
export type BotStatus =
  | "ready"
  | "joining_call"
  | "in_waiting_room"
  | "in_call_not_recording"
  | "in_call_recording"
  | "call_ended"
  | "done"
  | "fatal";

/** Webhook event names sent by Recall.ai for bot lifecycle changes. */
export type BotEventName =
  | "bot.joining_call"
  | "bot.in_waiting_room"
  | "bot.in_call_not_recording"
  | "bot.recording_permission_allowed"
  | "bot.recording_permission_denied"
  | "bot.in_call_recording"
  | "bot.call_ended"
  | "bot.done"
  | "bot.fatal";

/** Shape of the webhook payload Recall.ai POSTs to our /webhooks/recall endpoint. */
export interface RecallWebhookPayload {
  event: BotEventName;
  data: {
    data: {
      code: string;
      sub_code: string | null;
      updated_at: string;
    };
    bot: {
      id: string;
      metadata: Record<string, unknown>;
    };
  };
}

/** A single transcript word with timestamps returned by Recall.ai. */
export interface TranscriptWord {
  text: string;
  /** Timestamps for the recallai_streaming provider (relative + absolute). */
  start_timestamp?: {
    relative: number;
    absolute: string;
  };
  end_timestamp?: {
    relative: number;
    absolute: string;
  };
  /** Legacy flat timestamp fields (some providers). */
  start_time?: number;
  end_time?: number;
  confidence?: number | null;
}

/** A single transcript utterance — one speaker's continuous block of speech. */
export interface TranscriptEntry {
  speaker: string | null;
  speaker_id: string | null;
  words: TranscriptWord[];
  /** Convenience field: full text of the utterance joined from words. */
  text: string;
  start_time: number;
  end_time: number;
}

/**
 * Raw transcript utterance as returned by Recall.ai's recallai_streaming provider.
 *
 * The top-level array contains one object per utterance. Speaker identity is
 * in `participant.name`; timing lives inside each word's `start_timestamp` /
 * `end_timestamp` objects. A pre-joined `text` field is also included by the API.
 */
export interface RawTranscriptEntry {
  /** Pre-joined utterance text provided by the API. */
  text?: string;
  /** Legacy flat speaker name (older provider format). */
  speaker?: string | null;
  /** Legacy flat speaker ID (older provider format). */
  speaker_id?: string | null;
  /** Participant object used by the recallai_streaming provider. */
  participant?: {
    id?: number;
    name?: string | null;
    is_host?: boolean;
    platform?: string;
    email?: string | null;
    extra_data?: Record<string, unknown>;
  };
  words: TranscriptWord[];
  language_code?: string;
}

/**
 * Raw transcript download payload from Recall.ai.
 *
 * The recallai_streaming provider returns a top-level JSON array of utterances.
 */
export type RawRecallTranscript = RawTranscriptEntry[];

// ---------------------------------------------------------------------------
// Meeting types — our internal representation
// ---------------------------------------------------------------------------

/** The state we track for each meeting bot we dispatch. */
export interface MeetingRecord {
  bot_id: string;
  meeting_url: string;
  bot_name: string;
  status: BotStatus;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  /** Populated once the bot reaches the "done" state and media is available. */
  transcript: TranscriptEntry[] | null;
  insights: MeetingInsights | null;
}

// ---------------------------------------------------------------------------
// Intelligence types — output from the AI processing layer
// ---------------------------------------------------------------------------

/** Structured output from the intelligence service. */
export interface MeetingInsights {
  summary: string;
  action_items: ActionItem[];
  key_decisions: string[];
  participants: string[];
}

/** A single action item extracted from the meeting transcript. */
export interface ActionItem {
  task: string;
  /** The participant the action was assigned to, if identifiable. */
  owner: string | null;
}

// ---------------------------------------------------------------------------
// API request / response types
// ---------------------------------------------------------------------------

/** Request body for POST /api/meetings */
export interface CreateMeetingRequest {
  meeting_url: string;
  /** Display name shown in the meeting for the bot. Defaults to "Meeting Notetaker". */
  bot_name?: string;
}

/** Generic success response wrapper. */
export interface ApiResponse<T> {
  success: true;
  data: T;
}

/** Generic error response wrapper. */
export interface ApiErrorResponse {
  success: false;
  error: string;
}
