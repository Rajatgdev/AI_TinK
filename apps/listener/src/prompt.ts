import { createInterface } from "node:readline/promises";

const terminal = createInterface({ input: process.stdin, output: process.stdout });

/** Waits until Enter is pressed before returning the submitted line. */
export async function readLine(label: string): Promise<string> {
  return (await terminal.question(label)).trim();
}

export function closePrompt(): void {
  terminal.close();
}
