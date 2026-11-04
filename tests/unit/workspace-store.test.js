import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkspaceStore } from '../../cli/src/storage/workspace-store.js';

function createFakeMongoClient() {
  const documents = new Map();
  const calls = { reads: 0, writes: 0, closed: false, options: null, uri: null };
  class FakeMongoClient {
    constructor(uri, options) {
      calls.uri = uri;
      calls.options = options;
    }

    async connect() {}

    db(name) {
      calls.databaseName = name;
      return {
        collection() {
          return {
            async findOne({ _id }, options = {}) {
              calls.reads++;
              const document = documents.get(_id);
              if (!document) return null;
              if (options.projection) {
                const field = Object.keys(options.projection)[0].split('.')[1];
                return { _id, documents: { [field]: document.documents?.[field] } };
              }
              return structuredClone(document);
            },
            async updateOne(filter, update, options = {}) {
              calls.writes++;
              let document = documents.get(filter._id);
              if (!document && options.upsert) {
                document = { _id: filter._id };
                documents.set(filter._id, document);
              }
              if (!document) return { matchedCount: 0 };

              const condition = Object.entries(filter).find(([key]) => key.startsWith('documents.'));
              if (condition && condition[1]?.$exists === false) {
                const field = condition[0].split('.')[1];
                if (document.documents?.[field] !== undefined) return { matchedCount: 0 };
              }
              for (const [operator, values] of Object.entries(update)) {
                for (const [key, value] of Object.entries(values)) {
                  if (operator === '$setOnInsert' && document.createdAt) continue;
                  if (key.startsWith('documents.')) {
                    document.documents ||= {};
                    document.documents[key.split('.')[1]] = structuredClone(value);
                  } else {
                    document[key] = value;
                  }
                }
              }
              return { matchedCount: 1 };
            }
          };
        }
      };
    }

    async close() {
      calls.closed = true;
    }
  }
  return { documents, calls, MongoClientClass: FakeMongoClient };
}

test('workspace store keeps file mode when MongoDB is not configured', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-workspace-local-'));
  const store = createWorkspaceStore({ cwd, env: {} });
  const localDocument = { tasks: [] };
  assert.equal(await store.readDocument('tasks', async () => localDocument), localDocument);
  assert.equal(await store.writeDocument('tasks', { tasks: ['new'] }), false);
  await assert.rejects(readFile(path.join(cwd, '.apm', 'cache', 'local.json')));
  await store.close();
  await rm(cwd, { recursive: true, force: true });
});

test('MongoDB requires a stable workspace ID', () => {
  assert.throws(
    () => createWorkspaceStore({
      env: { MONGODB_URI: 'mongodb+srv://example.mongodb.net/' }
    }),
    /APM_WORKSPACE_ID/
  );
});

test('MongoDB connection failures do not silently fall back to local data', async () => {
  let fallbackCalled = false;
  class UnavailableMongoClient {
    async connect() {
      throw new Error('connection details must not be surfaced');
    }

    async close() {}
  }
  const store = createWorkspaceStore({
    cwd: os.tmpdir(),
    env: {
      MONGODB_URI: 'mongodb+srv://test.example.mongodb.net/',
      APM_WORKSPACE_ID: 'unavailable-workspace'
    },
    MongoClientClass: UnavailableMongoClient
  });
  await assert.rejects(
    store.readDocument('tasks', async () => {
      fallbackCalled = true;
      return { tasks: [] };
    }),
    error => {
      assert.match(error.message, /Could not connect to MongoDB/);
      assert.doesNotMatch(error.message, /connection details/);
      return true;
    }
  );
  assert.equal(fallbackCalled, false);
  await store.close();
});

test('workspace documents seed from files, cache locally, and write through to MongoDB', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-workspace-cloud-'));
  const fakeMongo = createFakeMongoClient();
  const store = createWorkspaceStore({
    cwd,
    env: {
      MONGODB_URI: 'mongodb+srv://test.example.mongodb.net/',
      APM_MONGODB_DATABASE: 'apm_test',
      APM_WORKSPACE_ID: 'test-workspace'
    },
    MongoClientClass: fakeMongo.MongoClientClass
  });
  t.after(async () => {
    await store.close();
    await rm(cwd, { recursive: true, force: true });
  });

  const seededEmployees = [{ Employee_ID: 'EMP-001', Employee_Name: 'Test User' }];
  let fallbackCalls = 0;
  assert.deepEqual(
    await store.readDocument('employees', async () => {
      fallbackCalls++;
      return seededEmployees;
    }),
    seededEmployees
  );
  assert.equal(fallbackCalls, 1);
  assert.equal(fakeMongo.calls.reads, 2);
  assert.equal(fakeMongo.calls.options.tls, true);
  assert.equal(fakeMongo.calls.databaseName, 'apm_test');
  assert.equal(fakeMongo.calls.uri, 'mongodb+srv://test.example.mongodb.net/');

  const cacheFiles = await (await import('node:fs/promises')).readdir(path.join(cwd, '.apm', 'cache'));
  assert.equal(cacheFiles.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.apm', 'cache', cacheFiles[0]), 'utf8'))
    .documents.employees.value, seededEmployees);

  const updatedEmployees = [{ Employee_ID: 'EMP-002', Employee_Name: 'Updated User' }];
  assert.equal(await store.writeDocument('employees', updatedEmployees), true);
  assert.deepEqual(await store.readDocument('employees'), updatedEmployees);
  assert.equal(fakeMongo.calls.writes, 3);
  await store.close();
  assert.equal(fakeMongo.calls.closed, true);
});
