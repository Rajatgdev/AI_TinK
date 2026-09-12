import "dotenv/config";

type MemoryExtraction = {
  summary: string;
  people: string[];
  importance: "low" | "medium" | "high";
  eventTitle: string | null;
  eventTimeText: string | null;
  memoryCue: string;
  confidence: number;
  needsConfirmation: boolean;
};

export async function extractMemory(input: {
  text: string;
  sentAt: string;
}): Promise<MemoryExtraction> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey || !model) {
    throw new Error("Missing OPENROUTER_API_KEY or OPENROUTER_MODEL in .env");
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Remember Me Hackathon",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `
You extract safe, source-backed memory records from Telegram messages.

Rules:
- Summarize only facts contained in the message.
- Never diagnose, infer health conditions, or invent a relationship.
- Identify an event only when it is explicitly described.
- Keep relative dates exactly as written. For example, keep "Tuesday at 1pm"; do not guess a calendar date.
- If there is no event, return null for eventTitle and eventTimeText.
- Mark high importance only for appointments, commitments, urgent requests, major updates, or meaningful family events.
- Set needsConfirmation true if an event matters but its timing or meaning is ambiguous.
            `.trim(),
          },
          {
            role: "user",
            content: JSON.stringify({
              messageText: input.text,
              messageSentAt: input.sentAt,
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "memory_extraction",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                people: {
                  type: "array",
                  items: { type: "string" },
                },
                importance: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                },
                eventTitle: {
                  type: ["string", "null"],
                },
                eventTimeText: {
                  type: ["string", "null"],
                },
                memoryCue: { type: "string" },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                },
                needsConfirmation: {
                  type: "boolean",
                },
              },
              required: [
                "summary",
                "people",
                "importance",
                "eventTitle",
                "eventTimeText",
                "memoryCue",
                "confidence",
                "needsConfirmation",
              ],
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned no structured content");
  }

  return JSON.parse(content) as MemoryExtraction;
}