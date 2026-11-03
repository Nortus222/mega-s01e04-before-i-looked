export type DigestStatus = 'ok' | 'retry' | 'fail';

export interface DigestRow {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  /** Counts every failure, including failures followed by recovery. */
  failures: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  /** Original timestamp string, preserving the log's offset. */
  firstAt: string;
  /** Original timestamp string, preserving the log's offset. */
  lastAt: string;
}

export interface NightDigest {
  night: string;
  /** One row per job; empty for an empty file. */
  rows: DigestRow[];
  badLines: number;
  /** Counts valid records by status, not jobs or their final statuses. */
  counts: {
    ok: number;
    retry: number;
    fail: number;
  };
}

/**
 * Returns null for a missing file or invalid night, and empty rows for an empty file.
 * Implemented by readNight in src/digest/read-night.ts.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
