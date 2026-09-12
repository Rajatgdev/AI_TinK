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
3. Run `npm run dev:listener`.

On first run, GramJS asks for the test account phone number and verification
code. It saves a session string locally in `.telegram.session`; treat that file
like a password and never commit or share it.

## Project structure

- `apps/listener` — Telegram user-client listener and selected-chat filtering.
- `packages/shared` — contracts shared by the listener, API, and bot.
- `infra` — local development infrastructure, added as the next step.
