export function createWorkspaceCache({ ttlMs = 30_000, maxEntries = 1_000 } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new Error('Cache TTL must be positive.');
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Cache size must be positive.');
  const entries = new Map();

  function cacheKey(tenantId, workspaceId, type) {
    return JSON.stringify([tenantId, workspaceId, type]);
  }

  return {
    get(tenantId, workspaceId, type) {
      const key = cacheKey(tenantId, workspaceId, type);
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return structuredClone(entry.value);
    },

    set(tenantId, workspaceId, type, value) {
      const key = cacheKey(tenantId, workspaceId, type);
      entries.delete(key);
      entries.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlMs });
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
    },

    deleteWorkspace(tenantId, workspaceId) {
      const prefix = JSON.stringify([tenantId, workspaceId]).slice(0, -1) + ',';
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },

    get size() {
      return entries.size;
    }
  };
}
