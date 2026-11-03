import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest, ReadNight } from './types.js';

interface RunRecord {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error: string | null;
}

function validNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(`${night}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

/** Validate untrusted JSON before it reaches the aggregation. */
function parseRecord(line: string): RunRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { at, job, status, owner, error } = record;
  if (typeof at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(at) ||
      !validNight(at.slice(0, 10)) || !Number.isFinite(Date.parse(at)) ||
      typeof job !== 'string' || job.trim().length === 0 ||
      (status !== 'ok' && status !== 'retry' && status !== 'fail') ||
      (owner != null && typeof owner !== 'string') ||
      (error != null && typeof error !== 'string')) return null;
  return { at, job, status, owner: owner ?? null, error: error ?? null };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validNight(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, DigestRow>();
  const lines = contents === '' ? [] : contents.split('\n');
  // A final newline terminates the last record; it does not add a record.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const record = parseRecord(line);
    if (!record) {
      digest.badLines++;
      continue;
    }
    digest.counts[record.status]++;
    let row = jobs.get(record.job);
    if (!row) {
      row = {
        job: record.job, owner: record.owner, runs: 0, retries: 0, failures: 0,
        lastStatus: record.status, lastError: record.error, firstAt: record.at, lastAt: record.at,
      };
      jobs.set(record.job, row);
    }
    row.runs++;
    if (record.status === 'retry') row.retries++;
    if (record.status === 'fail') row.failures++;
    row.owner = record.owner;
    row.lastStatus = record.status;
    row.lastError = record.error;
    row.lastAt = record.at;
  }
  digest.rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
