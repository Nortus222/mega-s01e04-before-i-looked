import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { readNight } from '../src/digest/read-night.js';

vi.mock('node:fs', { spy: true });

const night = '2026-10-28';
const at = '2026-10-28T23:00:02+01:00';
const record = { at, job: 'job', status: 'ok', owner: 'rook' };
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function write(records: unknown[]) {
  writeFileSync(join(dir, `${night}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n');
}

describe('readNight', () => {
  it('reads the supplied fixture without changing it', () => {
    const digest = readNight(new URL('../runs/', import.meta.url).pathname, night);
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows[1]).toMatchObject({ runs: 4, retries: 3, failures: 0, lastStatus: 'ok', lastError: null });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1 });
    expect(digest?.rows[3]).toMatchObject({ failures: 1, lastError: 'quota exceeded' });
  });

  it('distinguishes missing and empty files', () => {
    expect(readNight(dir, night)).toBeNull();
    writeFileSync(join(dir, `${night}.jsonl`), '');
    expect(readNight(dir, night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/../x', '2026-10-28\\x', '2026-10-28\n', '2026-02-30', '2025-02-29', '2026-13-01', '2026-1-01', ''])('rejects invalid night %j before IO', invalid => {
    const read = vi.spyOn(fs, 'readFileSync');
    expect(readNight(dir, invalid)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('accepts a leap-day night', () => {
    writeFileSync(join(dir, '2024-02-29.jsonl'), '');
    expect(readNight(dir, '2024-02-29')?.rows).toEqual([]);
  });

  it('counts malformed JSON and shapes without losing valid records', () => {
    const invalid: unknown[] = [null, [], 1, 'text', {},
      { ...record, job: '' }, { ...record, job: 1 }, { ...record, status: 'unknown' },
      { ...record, at: null }, { ...record, at: 'not a time' }, { ...record, at: '1' },
      { ...record, at: '2026-02-30T01:00:00Z' },
      { ...record, owner: {} }, { ...record, error: [] },
    ];
    write([record, ...invalid, { ...record, status: 'retry' }]);
    writeFileSync(join(dir, `${night}.jsonl`), fs.readFileSync(join(dir, `${night}.jsonl`), 'utf8') + '{bad\n\n');
    expect(readNight(dir, night)).toMatchObject({
      badLines: invalid.length + 2, counts: { ok: 1, retry: 1, fail: 0 },
      rows: [{ runs: 2, retries: 1 }],
    });
  });

  it('keeps missing and null owners and safely sorts arbitrary job keys', () => {
    write([
      { at, job: 'zebra', status: 'ok' },
      { ...record, job: 'constructor', owner: null },
      { ...record, job: '__proto__' }, { ...record, job: 'alpha' },
    ]);
    const rows = readNight(dir, night)!.rows;
    expect(rows.map(row => row.job)).toEqual(['__proto__', 'alpha', 'constructor', 'zebra']);
    expect(rows[2].owner).toBeNull();
    expect(rows[3].owner).toBeNull();
  });

  it('aggregates in log order, preserves offsets and failures after recovery', () => {
    const lastAt = '2026-10-28T20:00:00-04:00';
    write([
      { ...record, status: 'fail', error: 'broken' },
      ...Array.from({ length: 3 }, () => ({ ...record, status: 'retry', error: 'again' })),
      { ...record, at: lastAt, owner: null },
    ]);
    expect(readNight(dir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 3, fail: 1 },
      rows: [{ job: 'job', owner: null, runs: 5, retries: 3, failures: 1,
        lastStatus: 'ok', lastError: null, firstAt: at, lastAt }],
    });
  });

  it('uses last record fields even when timestamps decrease', () => {
    write([record, { at: '2026-10-27T01:00:00Z', job: 'job', status: 'fail', error: 'last' }]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({
      owner: null, firstAt: at, lastAt: '2026-10-27T01:00:00Z', lastError: 'last', lastStatus: 'fail',
    });
  });

  it('accepts CRLF records and a trailing newline', () => {
    writeFileSync(join(dir, `${night}.jsonl`), JSON.stringify(record) + '\r\n');
    expect(readNight(dir, night)?.badLines).toBe(0);
  });

  it('preserves fractional seconds and null errors', () => {
    const timestamp = '2026-10-28T23:00:02.123+05:30';
    write([{ ...record, at: timestamp, error: null }]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({ firstAt: timestamp, lastAt: timestamp, lastError: null });
  });

  it('does not disguise unexpected filesystem failures as missing nights', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('read failed'); });
    expect(() => readNight(dir, night)).toThrow('read failed');
  });
});
