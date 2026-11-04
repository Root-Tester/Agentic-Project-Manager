# Development guide

This guide is for contributors working on the CLI, hosted application, shared
modules, and release templates. For a product explanation and deployment
overview, start with the [product overview](../product-overview.md) and
[architecture](../architecture.md).

## Local checks

```powershell
npm ci
npm test
npm run build
npm audit
```

`tests/unit/` covers isolated modules; `tests/integration/` exercises command
and local HTTP API behavior. Node's built-in test runner discovers both.

## Extension guides

- [Assistant platform plugins](./plugins.md)
- [AI provider adapters](./ai-providers.md)
- [CLI standards](./cli-standards.md)
- [Build standards](./build-standards.md)
- [SQLite hosted deployment](../deployment/hosted-app.md)
- [Security readiness and operational limits](../security/readiness.md)
- [Terms of Use](../legal/terms-of-use.md)
- [Privacy Notice](../legal/privacy-notice.md)

The root `package.json` and `package-lock.json` are the dependency source of
truth. Commit both when changing dependencies.
