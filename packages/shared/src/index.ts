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
