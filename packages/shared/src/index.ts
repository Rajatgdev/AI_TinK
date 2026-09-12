import { z } from "zod";

/**
 * Immutable evidence captured from Telegram. Memories are derived separately
 * and must retain this source reference.
 */
export const SourceMessageSchema = z.object({
  provider: z.literal("telegram"),
  chatId: z.string().min(1),
  messageId: z.number().int().positive(),
  senderId: z.string().min(1).nullable(),
  senderName: z.string().min(1).nullable(),
  messageText: z.string().min(1),
  sentAt: z.string().datetime(),
  capturedAt: z.string().datetime(),
});

export type SourceMessage = z.infer<typeof SourceMessageSchema>;

export const MemoryExtractionSchema = z.object({
  summary: z.string().min(1).max(500),
  people: z.array(z.string().min(1).max(120)).max(20),
  event: z
    .object({
      title: z.string().min(1).max(250),
      occurredAt: z.string().datetime().nullable(),
    })
    .nullable(),
  importance: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
});

export type MemoryExtraction = z.infer<typeof MemoryExtractionSchema>;
