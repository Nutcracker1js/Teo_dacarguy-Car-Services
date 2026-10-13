const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { after, before, test } = require('node:test');
const { createAdminRouter } = require('./admin');

const submissionId = '6f015c78-18f1-4cff-a5cb-f957d0031704';
const attachmentId = 'e85a4be3-9f45-4c8a-8d68-6da4e22f499a';
const storageKey = 'f1bd10b5-fae8-4a18-a343-cc944f9bb868.png';
const adminUsername = 'test-admin';
const adminPassword = 'test-only-secret-password';
const queryCalls = [];
const pool = {
  async query(sql, values = []) {
    queryCalls.push({ sql, values });
    if (sql.includes('COUNT(*)::int')) return { rows: [{ total: 1 }] };
    if (sql.includes('SELECT * FROM (')) {
      return {
        rows: [{
          id: submissionId,
          type: 'enquiry',
          full_name: 'Ada Customer',
          status: 'NEW',
          attachments: [],
        }],
      };
    }
    if (sql.includes('UPDATE enquiries')) {
      return { rowCount: 1, rows: [{ id: submissionId, status: values[0] }] };
    }
    if (sql.includes('FROM submission_attachments')) {
      return {
        rowCount: 1,
        rows: [{
          storage_key: storageKey,
          original_name: 'vehicle photo.png',
          mime_type: 'image/png',
        }],
      };
    }
    return { rowCount: 0, rows: [] };
  },
};

let server;
let baseUrl;
let privateDirectory;
const authorization = `Basic ${Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64')}`;

before(async () => {
  privateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teo-admin-test-'));
  await fs.writeFile(path.join(privateDirectory, storageKey), Buffer.from('private-image'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', createAdminRouter({
    pool,
    username: adminUsername,
    password: adminPassword,
    privateDirectory,
  }));
  app.use('/api/v1/admin-disabled', createAdminRouter({
    pool,
    username: adminUsername,
    password: 'weak',
    privateDirectory,
  }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(privateDirectory, { recursive: true, force: true });
});

test('admin inbox rejects unauthenticated requests', async () => {
  const response = await fetch(`${baseUrl}/submissions`);
  assert.equal(response.status, 401);
});

test('admin inbox stays disabled until a strong password is configured', async () => {
  const response = await fetch(`${baseUrl.replace('/api/v1/admin', '/api/v1/admin-disabled')}/submissions`);
  assert.equal(response.status, 503);
});

test('admin inbox authenticates and applies validated filters', async () => {
  const response = await fetch(`${baseUrl}/submissions?type=enquiry&status=NEW&limit=25&offset=0`, {
    headers: { Authorization: authorization },
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.total, 1);
  assert.equal(result.submissions[0].full_name, 'Ada Customer');
  assert.deepEqual(queryCalls.at(-2).values, ['NEW', 25, 0]);

  const invalid = await fetch(`${baseUrl}/submissions?status=UNKNOWN`, {
    headers: { Authorization: authorization },
  });
  assert.equal(invalid.status, 400);
});

test('admin can update a submission status using an allowlisted value', async () => {
  const response = await fetch(`${baseUrl}/submissions/enquiry/${submissionId}/status`, {
    method: 'PATCH',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'CONTACTED' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: submissionId, status: 'CONTACTED' });
  assert.deepEqual(queryCalls.at(-1).values, ['CONTACTED', submissionId]);

  const invalid = await fetch(`${baseUrl}/submissions/enquiry/${submissionId}/status`, {
    method: 'PATCH',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ROOT' }),
  });
  assert.equal(invalid.status, 400);
});

test('admin attachment downloads require authentication and force attachment handling', async () => {
  const unauthenticated = await fetch(`${baseUrl}/attachments/${attachmentId}`);
  assert.equal(unauthenticated.status, 401);

  const response = await fetch(`${baseUrl}/attachments/${attachmentId}`, {
    headers: { Authorization: authorization },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await response.text(), 'private-image');

  const unsafeId = await fetch(`${baseUrl}/attachments/../../README.md`, {
    headers: { Authorization: authorization },
  });
  assert.equal(unsafeId.status, 404);
});

test('admin inbox rejects an invalid password', async () => {
  const mismatch = await fetch(`${baseUrl}/submissions`, {
    headers: { Authorization: `Basic ${Buffer.from(`${adminUsername}:wrong-password`).toString('base64')}` },
  });
  assert.equal(mismatch.status, 401);
});
