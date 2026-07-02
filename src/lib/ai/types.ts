export type AIUserContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; dataBase64: string }
  | { type: 'document'; mimeType: string; dataBase64: string };

export interface AITask<TInput, TOutput> {
  name: string;
  version: string;
  tier: 'vision' | 'text' | 'tool';
  needsVision: boolean;
  needsToolUse: boolean;
  maxOutputTokens: number;
  systemPrompt: string;
  toolName: string;
  toolDescription: string;
  toolInputSchema: Record<string, unknown>;
  buildUserContent(input: TInput): AIUserContent[];
  parseOutput(raw: unknown): TOutput;
}
