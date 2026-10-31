import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightCounts, NightDigest, RunLogEntry, RunStatus } from './types.js';

const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

function parseEntry(line: string): RunLogEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.at !== 'string' || record.at.length === 0) {
    return null;
  }
  if (typeof record.job !== 'string' || record.job.length === 0) {
    return null;
  }
  if (!isRunStatus(record.status)) {
    return null;
  }
  if (typeof record.owner !== 'string' && record.owner !== null) {
    return null;
  }
  if (record.error !== undefined && typeof record.error !== 'string') {
    return null;
  }

  const entry: RunLogEntry = {
    at: record.at,
    job: record.job,
    status: record.status,
    owner: record.owner,
  };
  if (typeof record.error === 'string') {
    entry.error = record.error;
  }
  return entry;
}

export function readNight(runsDir: string, night: string): NightDigest | null {
  if (!NIGHT_PATTERN.test(night)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }

  const byJob = new Map<string, DigestRow>();
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) {
      continue;
    }

    const entry = parseEntry(rawLine);
    if (!entry) {
      badLines += 1;
      continue;
    }

    counts[entry.status] += 1;

    const existing = byJob.get(entry.job);
    if (!existing) {
      byJob.set(entry.job, {
        job: entry.job,
        owner: entry.owner ?? null,
        runs: 1,
        retries: entry.status === 'retry' ? 1 : 0,
        lastStatus: entry.status,
        lastError: entry.error ?? null,
        firstAt: entry.at,
        lastAt: entry.at,
      });
    } else {
      existing.owner = entry.owner ?? null;
      existing.runs += 1;
      if (entry.status === 'retry') {
        existing.retries += 1;
      }
      existing.lastStatus = entry.status;
      if (entry.error !== undefined) {
        existing.lastError = entry.error;
      }
      existing.lastAt = entry.at;
    }
  }

  const rows = Array.from(byJob.values()).sort((a, b) => a.job.localeCompare(b.job));

  return {
    night,
    rows,
    badLines,
    counts,
  };
}
