# Assistant platform plugins

Platform targets are registered as data-only JSON manifests in
`plugins/assistant-platforms/`. The build system loads every `.json` file in
lexicographic filename order, checks that the filename matches the manifest
`id`, validates required fields, and rejects duplicate IDs and archive names.

## Add a target

1. Copy a nearby platform manifest, for example
   [cursor.json](../../plugins/assistant-platforms/cursor.json).
2. Save it as `plugins/assistant-platforms/<id>.json`; `<id>` must be a unique
   stable identifier.
3. Set a unique `name` and `bundleName`, the output `format`, and
   platform-specific `configDir` and `directories`.
4. Provide context-attachment and subagent guidance that matches the target's
   actual conventions. Use `null` for optional guidance that does not apply.
5. Run `npm test` and `npm run build`, then inspect the resulting archive in
   `dist/`.

Do not put executable code, credentials, or runtime application settings in
these manifests. Template source belongs under `templates/`; plugin manifests
describe how the build system maps that source into each assistant's bundle.
