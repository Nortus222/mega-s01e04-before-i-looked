import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

let runsDir: string;
let testDir: string;

async function writeNight(night: string, contents: string) {
  await writeFile(join(runsDir, `${night}.jsonl`), contents);
}

function record(at: string, job: string, status: string, owner: string | null, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

describe('digest routes', () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
    runsDir = join(testDir, 'runs');
    await mkdir(runsDir);
    config.runsDir = runsDir;
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('renders a night and returns the same sorted rows as JSON', async () => {
    await writeNight(
      '2026-10-28',
      [
        record('2026-10-28T07:15:00-07:00', 'zeta', 'ok', 'Zoë'),
        record('2026-10-28T07:00:00-07:00', 'alpha', 'fail', null, '<script>alert("x")</script>'),
        record('2026-10-28T07:05:00-07:00', 'alpha', 'retry', null),
        record('2026-10-28T07:10:00-07:00', 'alpha', 'retry', null),
        record('2026-10-28T07:20:00-07:00', 'alpha', 'retry', null),
        record('2026-10-28T07:25:00-07:00', 'alpha', 'ok', null),
      ].join('\n'),
    );

    const app = createApp(config);
    const [page, api] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    const html = await page.text();
    const digest = await api.json();

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(digest).toMatchObject({
      night: '2026-10-28',
      badLines: 0,
      counts: { ok: 2, retry: 3, fail: 1 },
      rows: [
        {
          job: 'alpha', owner: null, runs: 5, retries: 3, failures: 1,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T07:00:00-07:00', lastAt: '2026-10-28T07:25:00-07:00',
        },
        {
          job: 'zeta', owner: 'Zoë', runs: 1, retries: 0, failures: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T07:15:00-07:00', lastAt: '2026-10-28T07:15:00-07:00',
        },
      ],
    });
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zeta'));
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T07:00:00-07:00');
    expect(html).toContain('2026-10-28T07:25:00-07:00');
    const alphaRow = html.match(/<tr\b[^>]*>[\s\S]*?alpha[\s\S]*?<\/tr>/)?.[0];
    expect(alphaRow).toBeDefined();
    expect(alphaRow).toContain('class="warn"');
    expect(html).not.toContain('<script>alert("x")</script>');

  });

  it('escapes job, owner and current error text', async () => {
    await writeNight('2026-10-28', record('2026-10-28T07:00:00-07:00', '<job>', 'fail', '<owner>', '<script>alert(1)</script>'));
    const page = await createApp(config).request('/digest/2026-10-28');
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('&lt;job&gt;');
    expect(html).toContain('&lt;owner&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('returns 404 for a missing night', async () => {
    const app = createApp(config);
    expect((await app.request('/digest/2026-10-29')).status).toBe(404);
    expect((await app.request('/api/digest/2026-10-29')).status).toBe(404);
  });

  it('renders an empty file as a night where nothing ran', async () => {
    await writeNight('2026-10-28', '');

    const app = createApp(config);
    const [page, api] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(api.status).toBe(200);
    expect(await api.json()).toMatchObject({
      night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps rendering when a line is malformed and marks the warning', async () => {
    await writeNight(
      '2026-10-28',
      `${record('2026-10-28T07:00:00-07:00', 'still-here', 'ok', 'owner')}\n{not json`,
    );

    const app = createApp(config);
    const [page, api] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain('still-here');
    expect(html).toContain('class="warn"');
    expect(api.status).toBe(200);
    expect(await api.json()).toMatchObject({ badLines: 1, rows: [{ job: 'still-here' }] });
  });

  it('rejects traversal night names', async () => {
    const outsideNight = join(testDir, 'outside-night.jsonl');
    await writeFile(outsideNight, record('2026-10-28T07:00:00Z', 'outside', 'ok', null));
    try {
      const app = createApp(config);
      for (const path of ['/digest/..%2Foutside-night', '/api/digest/..%2Foutside-night']) {
        const response = await app.request(path);
        expect(response.status).toBe(404);
      }
    } finally {
      await rm(outsideNight, { force: true });
    }
  });
});
