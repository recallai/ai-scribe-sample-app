# AI Scribe Sample Application

A sample app that uses Recall.ai to record telehealth visits, transcribe them, and draft SOAP, DAP, or BIRP notes. You can optionally connect your calendar to make scheduling bots for upcoming meetings seamless. 

This is a demo meant to showcase how you can use the Recall.ai API in a healthcare context, but it is not production-ready. Do not use this sample application with real patients or healthcare conversations.

## Prerequisites

- Node.js 22 or newer
- [ngrok](https://ngrok.com/download) with a static domain (the free plan includes one; claim it under **Domains** in the ngrok dashboard)
- A [Recall.ai account](https://www.recall.ai/)
- An Anthropic or OpenAI API key
- A Zoom, Google Meet, or Microsoft Teams meeting you control

## Getting started

### Install

Clone the repository, then run:

```bash
npm install
cp .env.example .env
```

### Configure the MCP (highly recommended)

Connect the [Recall.ai MCP](https://docs.recall.ai/docs/docs-mcp) so an agent can search docs and inspect bots, webhooks, and logs in your workspace. You can also give the agent write permissions to allow it to set up webhook endpoints for you automatically. This will allow your agent to do most of the setup for this sample application.

The MCP is optional—every step below can also be done by hand in the Recall dashboard.

### Configure Recall

In your Recall dashboard, open **Developers → API keys** and create an API key and a workspace verification secret. Add them to `.env`:

```dotenv
RECALL_REGION=us-west-2
RECALL_API_KEY=your-api-key
RECALL_WEBHOOK_VERIFICATION_SECRET=whsec_your-secret
```

Set `RECALL_REGION` to your workspace's region: `us-west-2`, `us-east-1`, `eu-central-1`, or `ap-northeast-1`. Credentials are region-specific, so a mismatched region shows up as an authentication error. See [Recall regions](https://docs.recall.ai/docs/regions).

Transcription uses Recall's built-in transcription, so you don't need to set up a third-party transcription provider.

### Choose a model provider

Set **one** of these configurations in `.env`.

Anthropic ([create an API key](https://platform.claude.com/settings/keys)):

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-api-key
```

Or OpenAI ([create an API key](https://platform.openai.com/api-keys)):

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-api-key
```

If `AI_PROVIDER` is left blank, it defaults to `anthropic`. You can also set `AI_MODEL` to override the default model. See [.env.example](.env.example) for the remaining settings.

### Set up webhooks

In a separate terminal, expose the backend:

```bash
ngrok http 3000 --url https://YOUR-DOMAIN.ngrok-free.app
```

(Older ngrok versions use `--domain YOUR-DOMAIN.ngrok-free.app` instead of `--url`.)

If you've configured the Recall MCP with write permissions, you can ask your coding agent to finish the webhook setup. For example:

> Create a Recall webhook endpoint at `https://YOUR-DOMAIN.ngrok-free.app/webhooks/recall` subscribed to the events listed in this README.

If not, you'll have to do the next steps manually.

In Recall's webhook dashboard, add this endpoint:

```text
https://YOUR-DOMAIN.ngrok-free.app/webhooks/recall
```

Subscribe to these events: `bot.joining_call`, `bot.in_waiting_room`, `bot.in_call_not_recording`, `bot.in_call_recording`, `bot.call_ended`, `bot.done`, `bot.fatal`, `bot.recording_permission_denied`, `recording.done`, `recording.failed`, `transcript.done`, and `transcript.failed`. For calendars, also subscribe to `calendar.sync_events` and `calendar.update`.

### Run the app

You'll have three terminals running: ngrok, the backend, and the frontend.

Start the backend:

```bash
npm run dev
```

In another terminal, start the frontend:

```bash
npm run dev:client
```

Open [localhost:5173](http://localhost:5173). Keep both processes and ngrok running.

## Try it out

1. Start a meeting and open **New visit** in the app.
2. Enter a patient name, paste the meeting URL, and choose **Join now** or **Schedule**. Choose whether to record video, then send or schedule the bot.
3. Admit the bot and allow recording if prompted. Speak for a minute, then end the meeting.
4. Wait for the transcript and draft note to appear. Try playback, note regeneration, and chat.

## Connect a calendar (optional)

Set `PUBLIC_URL=https://YOUR-DOMAIN.ngrok-free.app` in `.env`. Create your own OAuth client using the guides below; use **this app's redirect URI** when following the videos.

Replace `$PUBLIC_URL` in the redirect URIs below with your actual HTTPS domain when entering them in Google or Microsoft—the dashboards won't expand it for you.

| Provider | Setup | Redirect URI | Environment variables |
| --- | --- | --- | --- |
| Google | [Video](https://youtu.be/KmCCFCDhuDY) · [Guide](https://docs.recall.ai/docs/calendar-v2-google-calendar) | `$PUBLIC_URL/calendar/callback/google` | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` |
| Microsoft | [Video](https://youtu.be/YEBVIbwzk_o) · [Guide](https://docs.recall.ai/docs/calendar-v2-microsoft-outlook) | `$PUBLIC_URL/calendar/callback/microsoft` | `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` |

Microsoft also supports certificates instead of a client secret; see the guide and certificate-path settings in [.env.example](.env.example).

Before connecting, run `npm run build`, then stop and restart `npm run dev` so it picks up the new `.env` values. The OAuth callback returns to the UI that Express serves at your public URL, not to the Vite dev server, so open the app at `https://YOUR-DOMAIN.ngrok-free.app` instead of `localhost:5173`. Then open **Calendar → Connect Google/Microsoft**, authorize access, adjust the recording settings above the event list, and click **Schedule AI Scribe**. The bot joins at the event's start time. Calendar visits use the event title; use **Settings** to optionally add a patient name or change a scheduled visit's options.

Connecting a calendar does not automatically record its meetings. Recall syncs events up to 28 days ahead. Google connections made with an OAuth client in testing expire after seven days.

## Where to look in the code

- [src/app.ts](src/app.ts): create and control bots.
- [src/recall.ts](src/recall.ts): API client, retries, pagination, and bot configuration.
- [src/webhooks.ts](src/webhooks.ts): recording completion, transcription, and note generation.
- [src/ai.ts](src/ai.ts): note and chat prompts.
- [src/calendar/](src/calendar): optional OAuth and calendar scheduling.

## Troubleshooting

- **Authentication errors:** check the key and region in `.env`, then restart the backend.
- **No transcript:** check that ngrok is running and Recall's webhook deliveries reach `/webhooks/recall`. Check the backend logs for signature or processing errors.
- **Calendar connection fails:** confirm that the registered redirect URI exactly matches your `PUBLIC_URL` and provider path.
- **Expired recording link:** select another visit and reopen the original to fetch a fresh URL.

To run the UI and API together on port 3000, use `npm run build` followed by `npm start`.
