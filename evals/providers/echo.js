/**
 * The real parser/categorizer output was already produced by collect-*.ts (the actual prod code
 * ran there, not here) -- this provider just hands that pre-computed value back so promptfoo has
 * something to run its llm-rubric assertion against.
 */
export default class PrecomputedProvider {
  id() {
    return 'precomputed'
  }

  async callApi(_prompt, context) {
    return { output: context.vars.parsed ?? context.vars.categoryId }
  }
}
