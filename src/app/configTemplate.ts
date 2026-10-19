export const CONFIG_TEMPLATE = `// Polymodel config. Docs: https://github.com/ryaninvents/polymodel
import { defineConfig, plannerExecutor } from '@ryaninvents/polymodel/plugin';

export default defineConfig({
  server: { host: '127.0.0.1', port: 4100 },

  // Where upstream models live. Reference them as "<provider>:<model>".
  providers: {
    litellm: {
      type: 'openai-compatible',
      baseURL: 'http://127.0.0.1:4000/v1',
      apiKey: { env: 'LITELLM_API_KEY' },
    },
    // anthropic: { type: 'anthropic', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  },

  // Each key is a model id exposed at /v1/models.
  models: {
    'opus-haiku': plannerExecutor({
      planner: 'litellm:claude-opus-5-5',
      executor: 'litellm:claude-haiku-5-5',
    }),
  },
});
`;
