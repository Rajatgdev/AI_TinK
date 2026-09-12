import "dotenv/config";
import type { MemoryWithSource } from "./db.js";

type Answer = {
  answer: string;
  memoryIds: number[];
  uncertain: boolean;
};

export async function answerQuestion(
  question: string,
  memories: MemoryWithSource[],
): Promise<Answer> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey || !model) {
    throw new Error("Missing OpenRouter configuration.");
  }

  const safeMemories = memories.map((memory) => ({
    id: memory.id,
    summary: memory.summary,
    people: JSON.parse(memory.peopleJson),
    eventTitle: memory.eventTitle,
    eventTimeText: memory.eventTimeText,
    originalMessage: memory.sourceText,
    messageSentAt: memory.sentAt,
  }));

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `
Answer only from the supplied memory records.

Rules:
- Never invent facts or dates.
- If the records do not answer the question, say so plainly.
- Use calm, short language suitable for a person with memory difficulties.
- Return the IDs of records used as sources.
- If dates are relative or uncertain, say that clearly.
            `.trim(),
          },
          {
            role: "user",
            content: JSON.stringify({
              question,
              memories: safeMemories,
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "memory_answer",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                answer: { type: "string" },
                memoryIds: {
                  type: "array",
                  items: { type: "number" },
                },
                uncertain: { type: "boolean" },
              },
              required: ["answer", "memoryIds", "uncertain"],
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
    throw new Error("OpenRouter did not return an answer.");
  }

  const answer = JSON.parse(content) as Answer;

  // Prevent a model response from citing a record we did not supply.
  const allowedIds = new Set(memories.map((memory) => memory.id));
  answer.memoryIds = answer.memoryIds.filter((id) => allowedIds.has(id));

  return answer;
}