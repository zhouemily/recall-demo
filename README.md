# recall-meeting-info

A Meeting Intelligence API built on [Recall.ai](https://recall.ai). Send a bot to any Zoom, Google Meet, or Microsoft Teams meeting and get back a clean transcript, summary, action items, and key decisions — all through a simple REST API.

---

## What it does

1. You call `POST /api/meetings` with a meeting URL.
2. A Recall.ai bot joins the meeting and records it.
3. When the meeting ends, Recall.ai sends a webhook to this server.
4. The server automatically fetches the transcript and generates insights.
5. You call `GET /api/meetings/:bot_id/insights` to retrieve the summary, action items, and decisions.

Insights are generated automatically via the webhook. The `POST /api/meetings/:bot_id/process` endpoint is also available as a manual fallback — useful if the webhook was missed or the server restarted before the meeting ended.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server liveness check |
| `POST` | `/api/meetings` | Send a bot to a meeting |
| `GET` | `/api/meetings` | List all tracked meetings |
| `GET` | `/api/meetings/:bot_id` | Get status and metadata for a meeting |
| `POST` | `/api/meetings/:bot_id/process` | Fetch transcript and generate insights |
| `GET` | `/api/meetings/:bot_id/transcript` | Get the full timestamped transcript |
| `GET` | `/api/meetings/:bot_id/insights` | Get summary, action items, and decisions |
| `POST` | `/api/webhooks/recall` | Recall.ai webhook receiver (register this URL in the Recall dashboard) |

---

## Project structure

```
src/
├── index.ts                   # Server entry point and middleware setup
├── config/
│   └── index.ts               # Environment variable loading and validation
├── routes/
│   ├── index.ts               # Route aggregator
│   ├── meetings.ts            # Meeting endpoints
│   └── webhooks.ts            # Recall.ai webhook receiver + signature verification
├── services/
│   ├── recallClient.ts        # All calls to the Recall.ai REST API
│   ├── transcriptService.ts   # Transcript fetching, normalisation, and formatting
│   └── intelligenceService.ts # Insight extraction: summary, action items, decisions
├── handlers/
│   └── botEventHandler.ts     # Routes webhook events to the right processing logic
├── store/
│   └── meetingStore.ts        # In-memory meeting state (swap for a DB here)
└── types/
    └── index.ts               # All shared TypeScript interfaces
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A [Recall.ai](https://recall.ai) account with an API key
- [ngrok](https://ngrok.com) (or any tunnel) to expose your local server for Recall.ai webhooks during development

---

## Setup

**1. Clone the repository**

```bash
git clone https://github.com/zhouemily/recall-demo.git
cd recall-demo
```

**2. Install dependencies**

```bash
npm install
```

**3. Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```env
RECALL_REGION=us-west-2
RECALL_API_KEY=your_recall_api_key_here
RECALL_WEBHOOK_SECRET=your_webhook_verification_secret_here
PORT=3000
```

Your Recall.ai region and credentials are available in your Recall dashboard under **Developers → API Keys & Secrets**.

**4. Start the development server**

```bash
npm run dev
```

**5. Expose the server for webhooks**

In a separate terminal:

```bash
ngrok http 3000
```

Copy the `https://` forwarding URL from ngrok (e.g. `https://abc123.ngrok-free.app`).

**6. Register the webhook in Recall.ai**

Go to your Recall.ai dashboard → **Webhooks** → **Add Endpoint** and enter:

```
https://abc123.ngrok-free.app/api/webhooks/recall
```

Subscribe to all `bot.*` events.

---

## Usage

**Send a bot to a meeting**

```bash
curl -X POST http://localhost:3000/api/meetings \
  -H "Content-Type: application/json" \
  -d '{"meeting_url": "https://meet.google.com/your-meeting-code"}'
```

Response:

```json
{
  "success": true,
  "data": {
    "bot_id": "abc-123-...",
    "meeting_url": "https://meet.google.com/your-meeting-code",
    "bot_name": "Meeting Notetaker",
    "status": "ready",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z",
    "transcript": null,
    "insights": null
  }
}
```

**Process the meeting after it ends**

```bash
curl -X POST http://localhost:3000/api/meetings/abc-123-.../process
```

**Get insights**

```bash
curl http://localhost:3000/api/meetings/abc-123-.../insights
```

Response:

```json
{
  "success": true,
  "data": {
    "summary": "The team discussed Q3 priorities. Emily confirmed the October 15th launch date and agreed to drop the price to $39 for the launch promotion.",
    "action_items": [
      { "task": "Follow up with the design team about final assets by end of week", "owner": "Emily" },
      { "task": "Make sure the landing page is ready by October 5th", "owner": "Sarah" }
    ],
    "key_decisions": [
      "Launch date confirmed as October 15th.",
      "Pricing set to $39 for the launch promotion."
    ],
    "participants": ["Emily", "Sarah"]
  }
}
```

---

## Tech stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **Meeting infrastructure**: Recall.ai
- **HTTP client**: Axios
