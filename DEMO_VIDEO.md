# Remember Me Demo Video

## Goal

Show that a person does not need to remember to forward messages. After consented setup, Remember Me watches only selected Telegram chats, turns meaningful messages into source-backed memories, and supports a caregiver pause control.

## Before recording

1. Stop the listener and bot with `Ctrl+C`.
2. Preserve the current test database by renaming `data/remember-me.db` to `data/remember-me.pre-demo.db`.
3. Start a fresh run with these terminals:

```bash
npm run listen
```

```bash
npm run bot
```

4. Use only the test family group and the bot's private chat. Do not show `.env`, terminal history containing credentials, or real conversations.

## Seed messages

Send these one at a time from a second test account in the monitored group:

```text
Mum, I will collect you for lunch tomorrow at 1pm.
```

```text
Your dentist appointment is Thursday at 10am.
```

Wait after each for the listener to print `SAVED MEMORY`.

## Recording sequence

### 0 to 10 seconds — the problem

Say: “For someone living with memory loss, important plans are often buried in ordinary family messages. Asking them to forward those messages to another app does not work.”

### 10 to 30 seconds — automatic capture

Show the family group receiving the lunch message. Then show the listener terminal logging `SAVED SOURCE MESSAGE` and `SAVED MEMORY`.

Say: “After one consented setup, Remember Me captures only the chats the person and caregiver have selected. Nothing needs to be forwarded.”

### 30 to 48 seconds — recall with evidence

Open the bot's private chat and send:

```text
/ask What am I doing tomorrow?
```

Show the short answer and its original-message source.

Say: “The answer is grounded in the original message, so it can say what it knows and show where it came from.”

### 48 to 65 seconds — proactive briefing

In a clean terminal, run:

```bash
npm run briefing:test
```

Show the Telegram briefing arriving.

Say: “It can also turn recent plans into a calm morning briefing.”

### 65 to 82 seconds — caregiver control

In the bot's private chat send:

```text
/pause
```

Send a harmless test message in the family group and show the listener printing `MONITORING PAUSED — message ignored.`

Say: “A caregiver can pause monitoring immediately. Consent and control are part of the product, not an afterthought.”

### 82 to 90 seconds — close

Say: “Remember Me is a consent-first Telegram memory companion: it helps people remember what matters, while keeping the caregiver in control.”

## Recovery plan

- If a bot answer is slow, show a previously successful `/ask` answer and continue.
- If the scheduled Trigger.dev task is not ready, use `npm run briefing:test`; it demonstrates the exact message delivery path.
- If the listener disconnects, restart `npm run listen` and send the seed message again.
