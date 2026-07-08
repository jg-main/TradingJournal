import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const DATA_DIR = '/srv/containers/trading-journal/data';
const UPLOADS_DIR = '/srv/containers/trading-journal/uploads';

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

describe('Host bind-mount directories', () => {
  it('data directory exists and is a directory', () => {
    const stat = fs.statSync(DATA_DIR);
    assert.ok(stat.isDirectory(), `${DATA_DIR} should be a directory`);
  });

  it('data directory is writable by UID 1001 (ownership or ACL)', () => {
    const stat = fs.statSync(DATA_DIR);
    const uid = stat.uid;
    assert.ok(
      uid === 1001 || hasAclEntry(DATA_DIR, 1001),
      `${DATA_DIR} should be writable by UID 1001 (ownership or ACL)`
    );
  });

  it('uploads directory exists and is a directory', () => {
    const stat = fs.statSync(UPLOADS_DIR);
    assert.ok(stat.isDirectory(), `${UPLOADS_DIR} should be a directory`);
  });

  it('uploads directory is writable by UID 1001 (ownership or ACL)', () => {
    const stat = fs.statSync(UPLOADS_DIR);
    const uid = stat.uid;
    assert.ok(
      uid === 1001 || hasAclEntry(UPLOADS_DIR, 1001),
      `${UPLOADS_DIR} should be writable by UID 1001 (ownership or ACL)`
    );
  });
});
