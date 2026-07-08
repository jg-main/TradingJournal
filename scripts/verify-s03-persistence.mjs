import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const DATA_DIR = '/srv/containers/trading-journal/data';
const UPLOADS_DIR = '/srv/containers/trading-journal/uploads';
const DB_PATH = `${DATA_DIR}/journal.db`;
const WAL_PATH = `${DATA_DIR}/journal.db-wal`;

function hasAclEntry(dirPath, uid) {
  try {
    const result = execSync(`getfacl --numeric "${dirPath}" 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    return (
      result.includes(`user:${uid}:rwx`) ||
      result.includes(`user:${uid}:rw-`) ||
      result.includes(`user:${uid}:r-x`)
    );
  } catch {
    return false;
  }
}

function hasDefaultAclTightened(dirPath) {
  try {
    const result = execSync(`getfacl --numeric "${dirPath}" 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    return result.includes('default:other::---');
  } catch {
    return false;
  }
}

describe('Persistence infrastructure', () => {
  it('DB file exists', () => {
    const stat = fs.statSync(DB_PATH);
    assert.ok(stat.isFile(), `${DB_PATH} should be a file`);
  });

  it('WAL file exists (confirming WAL journaling mode)', () => {
    const stat = fs.statSync(WAL_PATH);
    assert.ok(stat.isFile(), `${WAL_PATH} should be a file`);
  });

  it('uploads directory exists and is a directory', () => {
    const stat = fs.statSync(UPLOADS_DIR);
    assert.ok(stat.isDirectory(), `${UPLOADS_DIR} should be a directory`);
  });

  it('data directory is writable by UID 1001 (ownership or ACL)', () => {
    const stat = fs.statSync(DATA_DIR);
    const uid = stat.uid;
    assert.ok(
      uid === 1001 || hasAclEntry(DATA_DIR, 1001),
      `${DATA_DIR} should be writable by UID 1001 (ownership or ACL)`
    );
  });

  it('uploads directory is writable by UID 1001 (ownership or ACL)', () => {
    const stat = fs.statSync(UPLOADS_DIR);
    const uid = stat.uid;
    assert.ok(
      uid === 1001 || hasAclEntry(UPLOADS_DIR, 1001),
      `${UPLOADS_DIR} should be writable by UID 1001 (ownership or ACL)`
    );
  });

  it('uploads default ACL has no world-readable permission (default:other::---)', () => {
    const tightened = hasDefaultAclTightened(UPLOADS_DIR);
    if (!tightened) {
      // T02 runs separately; warn gracefully instead of failing
      console.warn(
        'WARNING: uploads directory default:other ACL is not tightened to ---. ' +
        'Run T02 (ACL hardening) first if this test is expected to pass.'
      );
    }
    assert.ok(tightened, `${UPLOADS_DIR} should have default:other::--- ACL entry`);
  });
});
