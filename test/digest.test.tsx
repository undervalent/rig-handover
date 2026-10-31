import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/index.js';

const baseConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-test-runs-'));
    app = createApp({ ...baseConfig, runsDir });

    // Populated night fixture (copied from runs/2026-10-28.jsonl)
    const fixture20261028 = readFileSync('runs/2026-10-28.jsonl', 'utf8');
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), fixture20261028);

    // Empty night
    writeFileSync(join(runsDir, '2026-10-20.jsonl'), '');

    // Night with a bad line
    writeFileSync(
      join(runsDir, '2026-10-21.jsonl'),
      '{"at":"2026-10-21T01:00:00+01:00","job":"test/job","status":"ok","owner":"rook"}\nmalformed json line\n',
    );
  });

  afterAll(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('200 on populated night with identical jobs in same order, warning classes, and dashes for nulls', async () => {
    const pageRes = await app.request('/digest/2026-10-28');
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();

    const apiRes = await app.request('/api/digest/2026-10-28');
    expect(apiRes.status).toBe(200);
    const data = (await apiRes.json()) as NightDigest;

    // Verify /api/digest/:night returns { night, rows, badLines, counts }
    expect(data).toHaveProperty('night', '2026-10-28');
    expect(data).toHaveProperty('rows');
    expect(data).toHaveProperty('badLines', 1);
    expect(data).toHaveProperty('counts', { ok: 10, retry: 4, fail: 1 });

    // Verify table rows on /digest/:night match api rows in exact same sorted order
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    expect(tbodyMatch).not.toBeNull();
    const tbody = tbodyMatch![1];
    const htmlJobs = Array.from(tbody.matchAll(/<tr>\s*<td>([^<]+)<\/td>/g)).map((m) => m[1]);
    const apiJobs = data.rows.map((r) => r.job);
    expect(htmlJobs).toEqual(apiJobs);
    expect(htmlJobs).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);

    // Verify marks retries >= 3 and fail with warn
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">fail</td>');

    // Verify shows — for owner: null and missing lastError
    const renderRowHtml = tbody.split('<tr>').find((r) => r.includes('digest/render'));
    expect(renderRowHtml).toBeDefined();
    expect(renderRowHtml).toContain('<td>digest/render</td><td>—</td>');
    expect(renderRowHtml).toContain('<td>ok</td><td>—</td>');
  });

  it('404 for a night with no file', async () => {
    const pageRes = await app.request('/digest/2026-10-99');
    expect(pageRes.status).toBe(404);

    const apiRes = await app.request('/api/digest/2026-10-99');
    expect(apiRes.status).toBe(404);
  });

  it('200 for empty night rendering "nothing ran" on page and rows: [] in JSON', async () => {
    const pageRes = await app.request('/digest/2026-10-20');
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('nothing ran');

    const apiRes = await app.request('/api/digest/2026-10-20');
    expect(apiRes.status).toBe(200);
    const data = (await apiRes.json()) as NightDigest;
    expect(data.rows).toEqual([]);
    expect(data.night).toBe('2026-10-20');
  });

  it('200 for night with a bad line without throwing, showing bad line count on page and badLines in JSON', async () => {
    const pageRes = await app.request('/digest/2026-10-21');
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('1 bad line');

    const apiRes = await app.request('/api/digest/2026-10-21');
    expect(apiRes.status).toBe(200);
    const data = (await apiRes.json()) as NightDigest;
    expect(data.badLines).toBe(1);
    expect(data.rows).toHaveLength(1);
  });
});
