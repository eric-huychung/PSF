import type { CategorizationProvider, Categorizer, LLMClient } from '../types'
import { createOpenRouterClient } from '../llm/openrouter'
import { createJevCategorizer } from './jevCategorize'

/**
 * Manual switch for trying a different categorization provider -- not user-facing, edit this
 * directly to experiment with 'haiku' / 'sonnet' / 'gpt5nano'. Jev is the default: it's a better
 * structural fit than a chat model here (pick-one-of-N is exactly the Choice primitive's job, and
 * Jev can't return a category id outside the list, unlike a chat model's free-text answer). If
 * Jev fails, `categorize()` throws -- there is no automatic fallback to another provider.
 */
export const CATEGORIZATION_PROVIDER: CategorizationProvider = 'jev'

export interface CategorizerOptions {
  apiKey: string
  /** Injectable for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch
}

/** Binds an `LLMClient` (one model per call) to a single fixed model, matching `Categorizer`'s one-model-per-instance shape. */
function fromLLMClient(client: LLMClient, model: 'haiku' | 'sonnet' | 'gpt5nano'): Categorizer {
  return {
    categorizeBatch: (transactions, categories) => client.categorizeBatch(transactions, categories, model),
  }
}

/** Constructs whichever categorizer `CATEGORIZATION_PROVIDER` (or an explicit override, for tests) names. */
export function createCategorizer(
  options: CategorizerOptions,
  provider: CategorizationProvider = CATEGORIZATION_PROVIDER,
): { categorizer: Categorizer; provider: CategorizationProvider } {
  if (provider === 'jev') return { categorizer: createJevCategorizer(options), provider }
  return { categorizer: fromLLMClient(createOpenRouterClient(options), provider), provider }
}
