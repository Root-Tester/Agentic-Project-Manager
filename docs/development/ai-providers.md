# AI provider adapters

The model integration is in `shared/ai/`. It calls hosted inference APIs; the
project does not train or run machine-learning models locally.

`shared/ai/index.js` owns provider selection and environment-variable lookup.
Provider implementations live in `shared/ai/providers/` and expose
`listModels(apiKey)` and `generate(prompt, modelName, apiKey)`:

```js
export async function listModels(apiKey) {
  // Return the text-generation model IDs available to this key.
}

export async function generate(prompt, modelName, apiKey) {
  // Return generated text; report provider failures without exposing credentials.
}
```

The local UI fetches model IDs from the selected provider when it opens,
whenever the provider changes, and when the user requests a refresh. The
hosted UI queries the authenticated backend. The hosted Gemini key can be
entered per user; it is retained in React memory only and sent in the
authenticated request body, never stored in session/local storage, SQLite, or
the frontend bundle. Backend-managed keys remain supported. Model catalogs are
not hard-coded or bundled with the app.

Gemini uses the `v1beta` models and `generateContent` endpoints and sends its
key in the `x-goog-api-key` header at `generativelanguage.googleapis.com`.
OpenAI uses `api.openai.com/v1/models` for discovery and
`api.openai.com/v1/responses` for generation. Anthropic uses
`api.anthropic.com/v1/models` and `api.anthropic.com/v1/messages`. Model IDs
are selected from the live catalog; if a provider rejects a key, model, quota,
or request, the UI shows an actionable provider error.

Model listing and generation require an authenticated tenant request. The
backend accepts request-scoped keys only for Gemini; OpenAI and Anthropic
remain server-configured. Gemini prompts include the milestone and employee
details supplied for task generation, so submit only information authorized
for processing by Google. Production deployments must use HTTPS.

Server-managed keys may be configured through backend environment variables
or the project-root `.env` file. Never put provider secrets in `VITE_`
variables. A user-entered Gemini key is cleared on page reload or organization
switch and is not included in workspace documents or audit records.

To add a provider:

1. Implement its API adapter in `shared/ai/providers/<provider>.js`.
2. Register the adapter, live model listing function, and environment variable
   in `shared/ai/index.js`.
3. Ensure credentials are supplied only to the backend adapter. Never place
   provider keys in frontend assets, URLs shown to users, logs, or source files.
4. Add tests for model discovery, provider selection, and credential validation; use mock
   responses rather than live model calls in the test suite.

Keep the provider contract independent from task parsing and validation. Those
belong to `shared/schemas/tasks.js`.
