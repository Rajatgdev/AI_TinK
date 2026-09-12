# Remember Me

A consent-first Telegram memory companion hackathon prototype. It monitors only
explicitly selected test chats, keeps every generated memory linked to an
original source message, and is not a medical device.

## First milestone

The first deliverable is automatic, allow-listed text capture:

1. Authenticate one pre-authorized **test** Telegram account.
2. Send a message in a selected test group.
3. See a validated `SourceMessage` printed by the listener.
4. Confirm that messages from all other chats are ignored.

## Local setup

1. Copy `.env.example` to `.env` and enter credentials for a dedicated test
   account and test chats only.
2. Install dependencies with `npm install`.
3. Run `npm run list:chats` once. Copy only the chosen test group’s numeric ID
   into `TELEGRAM_ALLOWED_CHAT_IDS`.
4. Run `npm run dev:listener`.

The next local service is the source API. Start Postgres with
`docker compose up -d postgres`, then run `npm run dev:api` in a second terminal.

To enable memory extraction, add an OpenRouter key and a model name to `.env`.
The API always stores the raw Telegram source first; an unavailable or invalid AI
response must never erase or block that evidence.

On first run, GramJS asks for the test account phone number and verification
code. It saves a session string locally in `.telegram.session`; treat that file
like a password and never commit or share it.

## Project structure

- `apps/listener` — Telegram user-client listener and selected-chat filtering.
- `apps/bot` — Telegram bot with source-backed `/ask` answers.
- `packages/shared` — contracts shared by the listener, API, and bot.
- `infra` — local Postgres schema for development.

In the prototype, `/pause`, `/resume`, and the Delete memory button require a
Telegram user ID listed in `TELEGRAM_CAREGIVER_USER_IDS`. Use the numeric user
ID shown by your test chat-ID bot; never use a group ID for this setting.
