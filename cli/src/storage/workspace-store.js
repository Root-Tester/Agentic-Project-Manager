import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';
import { MongoClient } from 'mongodb';
import { normalizeTaskStatuses } from '../../../shared/schemas/tasks.js';

const DOCUMENT_TYPES = new Set(['milestone', 'employees', 'tasks']);
const CACHE_TTL_MS = 30_000;

export class WorkspaceStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkspaceStoreError';
  }
}

function validateWorkspaceId(workspaceId) {
  if (
    typeof workspaceId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(workspaceId)
  ) {
    throw new Error('APM_WORKSPACE_ID must be 2-128 characters using letters, numbers, ".", "_", ":", or "-".');
  }
}

function validateDatabaseName(databaseName) {
  if (typeof databaseName !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(databaseName)) {
    throw new Error('APM_MONGODB_DATABASE must be 1-63 letters, numbers, underscores, or hyphens.');
  }
}

export function createWorkspaceStore({
  cwd = process.cwd(),
  env = process.env,
  MongoClientClass = MongoClient
} = {}) {
  const uri = env.MONGODB_URI?.trim();
  const databaseName = env.APM_MONGODB_DATABASE || 'agentic_project_manager';
  const workspaceId = env.APM_WORKSPACE_ID;
  const cacheFileName = workspaceId
    ? `${createHash('sha256').update(workspaceId).digest('hex')}.json`
    : 'local.json';
  const cachePath = path.join(cwd, '.apm', 'cache', cacheFileName);
  let client;
  let cache;

  if (uri) {
    if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
      throw new Error('MONGODB_URI must be a MongoDB connection string.');
    }
    if (!workspaceId) {
      throw new Error('Set APM_WORKSPACE_ID to a stable, unique ID before enabling MongoDB storage.');
    }
    validateWorkspaceId(workspaceId);
    validateDatabaseName(databaseName);
  }

  function assertDocumentType(type) {
    if (!DOCUMENT_TYPES.has(type)) {
      throw new Error(`Unsupported workspace document type: ${type}`);
    }
  }

  function normalizeDocument(type, value) {
    return type === 'tasks' ? normalizeTaskStatuses(value) : value;
  }

  async function getCollection() {
    try {
      if (!client) {
        client = new MongoClientClass(uri, {
          appName: 'AgenticProjectManager',
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 10_000,
          tls: true
        });
      }
      await client.connect();
      return client.db(databaseName).collection('workspaces');
    } catch {
      client = undefined;
      throw new WorkspaceStoreError('Could not connect to MongoDB. Check Atlas network access and the server-side MONGODB_URI setting.');
    }
  }

  async function readCache() {
    if (cache) return cache;
    try {
      const contents = await fs.readJson(cachePath);
      if (
        !contents ||
        contents.workspaceId !== workspaceId ||
        !contents.documents ||
        typeof contents.documents !== 'object' ||
        Array.isArray(contents.documents)
      ) {
        throw new WorkspaceStoreError('Invalid local workspace cache structure.');
      }
      for (const [type, cachedDocument] of Object.entries(contents.documents)) {
        if (
          !DOCUMENT_TYPES.has(type) ||
          !cachedDocument ||
          typeof cachedDocument !== 'object' ||
          !Object.hasOwn(cachedDocument, 'value') ||
          !Number.isFinite(cachedDocument.cachedAt)
        ) {
          throw new WorkspaceStoreError(`Invalid local cache entry for ${type}.`);
        }
      }
      cache = contents;
    } catch (error) {
      if (error.code === 'ENOENT') {
        cache = { workspaceId, documents: {} };
      } else {
        if (error instanceof WorkspaceStoreError) throw error;
        throw new WorkspaceStoreError(`Could not read the local workspace cache: ${error.message}`);
      }
    }
    return cache;
  }

  async function writeCache(type, value, updatedAt) {
    const current = await readCache();
    current.documents[type] = { value, updatedAt, cachedAt: Date.now() };
    try {
      await fs.ensureDir(path.dirname(cachePath));
      await fs.writeFile(cachePath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      throw new WorkspaceStoreError(`Could not update local workspace cache: ${error.message}`);
    }
    try {
      await fs.chmod(cachePath, 0o600);
    } catch (error) {
      if (process.platform !== 'win32') {
        throw new WorkspaceStoreError(`Could not secure local workspace cache permissions: ${error.message}`);
      }
    }
  }

  async function readLocalDocument(fallbackLoader) {
    if (typeof fallbackLoader !== 'function') return null;
    return await fallbackLoader();
  }

  return {
    get cloudEnabled() {
      return Boolean(uri);
    },

    async readDocument(type, fallbackLoader) {
      assertDocumentType(type);
      if (!uri) return normalizeDocument(type, await readLocalDocument(fallbackLoader));

      const localCache = await readCache();
      const cached = localCache.documents[type];
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return normalizeDocument(type, cached.value);
      }

      const collection = await getCollection();
      const projection = { [`documents.${type}`]: 1 };
      let workspace;
      try {
        workspace = await collection.findOne({ _id: workspaceId }, { projection });
      } catch {
        throw new WorkspaceStoreError(`Could not read the ${type} document from MongoDB.`);
      }
      let storedDocument = workspace?.documents?.[type];
      if (storedDocument && Object.hasOwn(storedDocument, 'value')) {
        const value = normalizeDocument(type, storedDocument.value);
        await writeCache(type, value, storedDocument.updatedAt);
        return value;
      }

      const localValue = normalizeDocument(type, await readLocalDocument(fallbackLoader));
      if (localValue === null || localValue === undefined) return null;

      try {
        await collection.updateOne(
          { _id: workspaceId },
          { $setOnInsert: { createdAt: new Date().toISOString() } },
          { upsert: true }
        );
        await collection.updateOne(
          { _id: workspaceId, [`documents.${type}`]: { $exists: false } },
          {
            $set: {
              [`documents.${type}`]: {
                value: localValue,
                updatedAt: new Date().toISOString()
              }
            }
          }
        );
        workspace = await collection.findOne({ _id: workspaceId }, { projection });
      } catch {
        throw new WorkspaceStoreError(`Could not read the ${type} document from MongoDB.`);
      }
      storedDocument = workspace?.documents?.[type];
      if (!storedDocument || !Object.hasOwn(storedDocument, 'value')) {
        throw new WorkspaceStoreError(`MongoDB did not return the initialized ${type} document.`);
      }
      const value = normalizeDocument(type, storedDocument.value);
      await writeCache(type, value, storedDocument.updatedAt);
      return value;
    },

    async writeDocument(type, value) {
      assertDocumentType(type);
      if (!uri) return false;
      value = normalizeDocument(type, value);
      const updatedAt = new Date().toISOString();
      try {
        const collection = await getCollection();
        await collection.updateOne(
          { _id: workspaceId },
          {
            $set: { [`documents.${type}`]: { value, updatedAt } },
            $setOnInsert: { createdAt: updatedAt }
          },
          { upsert: true }
        );
      } catch {
        throw new WorkspaceStoreError(`Could not save the ${type} document to MongoDB.`);
      }
      await writeCache(type, value, updatedAt);
      return true;
    },

    async close() {
      if (client) {
        const activeClient = client;
        client = undefined;
        await activeClient.close();
      }
    }
  };
}
