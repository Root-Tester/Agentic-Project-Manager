# Versioning and releases

APM has two release outputs: the npm package and the assistant-workflow
template bundles. They are released separately.

## npm package

The package version is the `version` field in `package.json`. The CLI reads
this value at runtime. Update it according to Semantic Versioning when
publishing a package release.

## Workflow template bundles

Template source is stored in `templates/`, and supported assistant targets
are listed in `plugins/assistant-platforms/`. Run `npm run build:release` to
create the bundles and the `apm-release.json` manifest in `dist/`.

The GitHub Actions workflow at
`.github/workflows/release-templates.yml` publishes these artifacts as a
GitHub Release. It accepts a semantic-version override; if none is provided,
it increments the patch component of the latest stable `vX.Y.Z` tag. The
template release version is not automatically taken from `package.json`.

The CLI filters official repository releases to the same major version as the
CLI package. Custom repositories are not filtered by major version, so users
should review their source and compatibility before installing a release.
See the [security readiness guide](./docs/security/readiness.md) for the
project's security scope and operational limitations.

## Release checks

Before publishing, run the tests and build the required outputs:

```powershell
npm test
npm run build:web
npm run build:release
```

Keep the changelog historical. It records earlier project releases and is not
a substitute for current setup or security instructions.
