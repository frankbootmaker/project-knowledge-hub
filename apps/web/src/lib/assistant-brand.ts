export {
  assistantBrandSchema,
  resolveAssistantBrand,
  type AssistantBrand,
} from '@project-knowledge-hub/domain';

export const ASSISTANT_BRANDS = [
  'cursor',
  'openai',
  'claude',
  'gemini',
  'ollama',
  'openwebui',
  'generic',
] as const;
