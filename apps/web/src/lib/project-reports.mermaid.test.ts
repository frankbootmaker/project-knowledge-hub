import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { accessSync, constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MERMAID_TEXT_MAX,
  buildBudgetBurndownMermaid,
  buildDeliveryStatusReport,
  buildDeliveryTimelineMermaid,
  buildOrgHierarchyMermaid,
  buildRaidBreakdownMermaid,
  mermaidGanttText,
  mermaidQuotedLabel,
  type ReportBudgetSummary,
  type ReportMilestone,
  type ReportStakeholder,
  type ReportTask,
} from './project-reports';

/** The pre-fix sanitiser. Kept here so a render of its output still fails. */
function legacyMermaidLabel(value: string): string {
  return value.replace(/[[\]"#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
}

const REGRESSION_TITLES = [
  'MCP / API tokens hardening: write scopes admin-only, self-service read tokens',
  'Admin pages layout polish: wrapping and inner padding (Verwaltung)',
  'UX1-B: guided flow – 5 phases, footer Weiter/Zurück, header back-nav',
] as const;

const ADVERSARIAL_TITLES = [
  ':',
  ';',
  '#',
  '"quoted"',
  '[brackets]',
  '(parens)',
  'comma, list',
  'cost & delay',
  'dash – here',
  'Übernahme',
  'árvíztűrő tükörfúrógép',
  '',
  'A'.repeat(200),
  ...REGRESSION_TITLES,
  'Mix: semi; hash # quote " brackets [ ] parens ( ) comma, amp & – őűáé',
];

function task(partial: Partial<ReportTask> & Pick<ReportTask, 'title'>): ReportTask {
  return {
    status: 'todo',
    dueDate: '2026-10-08',
    milestoneId: null,
    forecastHours: null,
    actualHours: null,
    ...partial,
  };
}

function stakeholder(
  partial: Partial<ReportStakeholder> &
    Pick<ReportStakeholder, 'displayName' | 'userId'>,
): ReportStakeholder {
  return {
    kind: 'person',
    email: null,
    projectRole: null,
    jobTitle: null,
    reportsToUserId: null,
    hourlyRate: null,
    raciRoles: [],
    notes: null,
    ...partial,
  };
}

function unwrapMermaid(fenced: string | null): string {
  expect(fenced).toBeTruthy();
  const match = fenced?.match(/```mermaid\n([\s\S]*?)\n```/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? '';
}

function assertGanttLine(line: string, kind: 'task' | 'milestone') {
  const sep = line.indexOf(' :');
  expect(sep).toBeGreaterThan(2);
  const name = line.slice(2, sep);
  const rest = line.slice(sep);
  expect(name).not.toMatch(/[:;#]/);
  expect(name.length).toBeGreaterThan(0);
  expect(name.length).toBeLessThanOrEqual(MERMAID_TEXT_MAX);
  if (kind === 'milestone') {
    expect(rest).toMatch(/^ :milestone, m\d+, \d{4}-\d{2}-\d{2}, 0d$/);
  } else {
    expect(rest).toMatch(/^ :(done, )?t\d+, \d{4}-\d{2}-\d{2}, 1d$/);
  }
}

type CdpResult = { result?: { value?: string } };

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((path): path is string => Boolean(path));

/** First runnable Chrome or Chromium, or null when CI has neither. */
function chromeExecutable(): string | null {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next well-known path.
    }
  }
  for (const name of [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ]) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    const path = found.stdout?.trim() ?? '';
    if (found.status === 0 && path) return path;
  }
  return null;
}

const chromeBin = chromeExecutable();
/** Set MERMAID_RENDER_TEST=1 to fail instead of skip when Chrome is missing. */
const requireMermaidRender = process.env.MERMAID_RENDER_TEST === '1';

function waitForStderr(
  chrome: ChildProcess,
  pattern: RegExp,
  timeoutMs: number,
): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Chrome did not start: ${buf}`));
    }, timeoutMs);
    function onData(chunk: Buffer | string) {
      buf += chunk.toString();
      const match = buf.match(pattern);
      if (match) {
        cleanup();
        resolve(match);
      }
    }
    function onError(error: Error) {
      cleanup();
      reject(new Error(`Chrome did not start: ${error.message}`));
    }
    function cleanup() {
      clearTimeout(timer);
      chrome.stderr?.off('data', onData);
      chrome.off('error', onError);
    }
    chrome.stderr?.on('data', onData);
    chrome.once('error', onError);
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
        return;
      }
      reject(new Error('Could not bind the mermaid fixture server'));
    });
  });
}

async function renderMermaidInChrome(
  executable: string,
  sources: string[],
): Promise<Array<{ ok: boolean; error: string | null }>> {
  const require = createRequire(import.meta.url);
  const mermaidPkg = require.resolve('mermaid/package.json');
  const mermaidDist = join(dirname(mermaidPkg), 'dist');
  const html = `<!DOCTYPE html>
<meta charset="utf-8" />
<body>
<script src="/vendor/mermaid.min.js"></script>
<script>
  const sources = ${JSON.stringify(sources)};
  void (async () => {
  try {
    const mermaid = globalThis.mermaid;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
    });
    const results = [];
    for (let index = 0; index < sources.length; index += 1) {
      const id = 'khDiagram' + index;
      try {
        const rendered = await mermaid.render(id, sources[index]);
        const svg = rendered && rendered.svg ? rendered.svg : '';
        const bomb = /aria-roledescription="error"|>Syntax error in text</.test(svg);
        results.push({
          ok: Boolean(svg.includes('<svg') && !bomb),
          error: bomb ? 'bomb' : null,
        });
      } catch (err) {
        results.push({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    window.__results = results;
  } catch (err) {
    window.__results = [{
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }];
  }
  })();
</script>
</body>`;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(html);
      return;
    }
    if (url.pathname.startsWith('/vendor/')) {
      const relative = normalize(url.pathname.slice('/vendor/'.length));
      if (relative.startsWith('..')) {
        response.writeHead(403);
        response.end();
        return;
      }
      try {
        const body = await readFile(join(mermaidDist, relative));
        response.setHeader('content-type', 'text/javascript; charset=utf-8');
        response.end(body);
        return;
      } catch {
        response.writeHead(404);
        response.end();
        return;
      }
    }
    response.writeHead(404);
    response.end();
  });
  const httpPort = await listen(server);

  const dir = await mkdtemp(join(tmpdir(), 'kh-mermaid-'));
  const chrome = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${join(dir, 'profile')}`,
      '--remote-debugging-port=0',
      `http://127.0.0.1:${httpPort}/`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let ws: WebSocket | null = null;
  try {
    const started = await waitForStderr(
      chrome,
      /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//,
      15_000,
    );
    const port = started[1];
    const version = (await fetch(
      `http://127.0.0.1:${port}/json/version`,
    ).then((response) => response.json())) as { webSocketDebuggerUrl: string };
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws?.addEventListener('open', () => resolve());
      ws?.addEventListener('error', () => reject(new Error('DevTools socket failed')));
    });

    let nextId = 0;
    const pending = new Map<
      number,
      { resolve: (value: CdpResult) => void; reject: (error: Error) => void }
    >();
    const logs: string[] = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: { exceptionDetails?: { text?: string; exception?: { description?: string } } };
        result?: CdpResult;
        error?: { message?: string };
      };
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails;
        logs.push(details?.exception?.description ?? details?.text ?? 'exception');
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        logs.push('console');
      }
      if (message.id == null || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (!waiter) return;
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? 'cdp error'));
      } else {
        waiter.resolve(message.result ?? {});
      }
    });

    function send(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ): Promise<CdpResult> {
      const id = ++nextId;
      const payload: {
        id: number;
        method: string;
        params: Record<string, unknown>;
        sessionId?: string;
      } = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws?.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    }

    const listed = (await send('Target.getTargets')) as {
      targetInfos?: Array<{ targetId: string; type: string; url: string }>;
    };
    const page = listed.targetInfos?.find(
      (target) => target.type === 'page' && target.url.includes(String(httpPort)),
    );
    if (!page) {
      throw new Error(
        `Chrome page missing: ${(listed.targetInfos ?? []).map((target) => target.url).join(', ')}`,
      );
    }
    const attached = (await send('Target.attachToTarget', {
      targetId: page.targetId,
      flatten: true,
    })) as { sessionId?: string };
    const sessionId = attached.sessionId;
    if (!sessionId) {
      throw new Error('Chrome did not attach to the diagram page');
    }
    await send('Runtime.enable', {}, sessionId);

    const deadline = Date.now() + 30_000;
    let raw = '';
    while (Date.now() < deadline) {
      const evaluated = await send(
        'Runtime.evaluate',
        {
          expression: 'window.__results ? JSON.stringify(window.__results) : ""',
          returnByValue: true,
        },
        sessionId,
      );
      raw = evaluated.result?.value ?? '';
      if (raw) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!raw) {
      const href = await send(
        'Runtime.evaluate',
        { expression: 'document.documentElement.outerHTML.slice(0, 500)', returnByValue: true },
        sessionId,
      );
      throw new Error(
        `Mermaid render did not finish in Chrome. ${logs.join(' | ')} ${href.result?.value ?? ''}`,
      );
    }
    return JSON.parse(raw) as Array<{ ok: boolean; error: string | null }>;
  } finally {
    ws?.close();
    chrome.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      if (chrome.exitCode != null || chrome.signalCode != null) {
        resolve();
        return;
      }
      chrome.once('exit', () => resolve());
      setTimeout(resolve, 2_000);
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

describe('mermaid label sanitising', () => {
  it('strips gantt separators and truncates with an ellipsis', () => {
    expect(mermaidGanttText('A: B; C # D')).toBe('A B C D');
    expect(mermaidGanttText('Übernahme')).toBe('Übernahme');
    expect(mermaidGanttText('árvíztűrő tükörfúrógép')).toBe(
      'árvíztűrő tükörfúrógép',
    );
    expect(mermaidGanttText('')).toBe('…');
    expect(mermaidGanttText(':::')).toBe('…');
    const long = mermaidGanttText('B'.repeat(200));
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBe(MERMAID_TEXT_MAX);
    expect(long.length).toBeGreaterThan(legacyMermaidLabel('B'.repeat(200)).length);
  });

  it('quotes and escapes pie, flowchart, and xychart labels', () => {
    expect(mermaidQuotedLabel('A: "B"')).toBe('A: #quot;B#quot;');
    expect(mermaidQuotedLabel('a;b#c & [d]')).toBe(
      'a#59;b#35;c #amp; #91;d#93;',
    );
    expect(mermaidQuotedLabel('őűáéíóöü')).toBe('őűáéíóöü');
    expect(mermaidQuotedLabel('')).toBe('…');
    const long = mermaidQuotedLabel('C'.repeat(200));
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBe(MERMAID_TEXT_MAX);
  });

  it('builds gantt lines whose names contain no colon, semicolon, or hash', () => {
    const milestones: ReportMilestone[] = ADVERSARIAL_TITLES.map((title, index) => ({
      title,
      status: 'active',
      targetDate: `2026-11-${String((index % 27) + 1).padStart(2, '0')}`,
    }));
    const tasks = ADVERSARIAL_TITLES.map((title, index) =>
      task({
        title,
        status: title.includes('Verwaltung') ? 'done' : 'todo',
        dueDate: `2026-10-${String((index % 27) + 1).padStart(2, '0')}`,
      }),
    );
    const source = unwrapMermaid(
      buildDeliveryTimelineMermaid({
        milestones,
        tasks,
        milestonesSection: 'Milestones: phase; #1',
        tasksSection: 'Tasks',
      }),
    );

    const sectionLines = source
      .split('\n')
      .filter((line) => line.trim().startsWith('section '));
    expect(sectionLines.length).toBeGreaterThan(0);
    for (const line of sectionLines) {
      expect(line).not.toMatch(/[:;#]/);
    }

    const milestoneLines = source
      .split('\n')
      .filter((line) => line.includes(':milestone,'));
    const taskLines = source
      .split('\n')
      .filter((line) => / :(done, )?t\d+,/.test(line));
    expect(milestoneLines.length).toBe(milestones.length);
    expect(taskLines.length).toBe(tasks.length);
    for (const line of milestoneLines) assertGanttLine(line, 'milestone');
    for (const line of taskLines) assertGanttLine(line, 'task');

    const doneLine = taskLines.find((line) => line.includes(':done,'));
    expect(doneLine).toBeTruthy();
    expect(doneLine).toContain('Verwaltung');
    expect(doneLine).not.toContain(': wrapping');

    const legacy = legacyMermaidLabel(REGRESSION_TITLES[1]);
    expect(legacy).toContain(':');
    expect(source).not.toContain(legacy);
  });

  it('quotes xychart titles and categories', () => {
    const budget: ReportBudgetSummary = {
      currency: 'EUR',
      initialBudget: 100,
      approvedBudget: 100,
      bac: 100,
      pv: 40,
      ev: 30,
      ac: 50,
      cpi: 0.6,
      spi: 0.75,
      financialRag: 'amber',
      riskRag: 'green',
      burndown: [
        { capturedOn: '2026-10-01', bac: 100, pv: 10, ev: 8, ac: 12 },
        { capturedOn: '2026-10-02', bac: 100, pv: 20, ev: 16, ac: 24 },
      ],
    };
    const series = unwrapMermaid(buildBudgetBurndownMermaid(budget));
    expect(series).toContain('title "Remaining budget"');
    expect(series).toContain('"10-01"');
    expect(series).toContain('"10-02"');

    const snapshot = unwrapMermaid(
      buildBudgetBurndownMermaid({ ...budget, burndown: [] }),
    );
    expect(snapshot).toContain('title "EVM snapshot"');
    expect(snapshot).toContain('x-axis ["BAC", "PV", "EV", "AC"]');
  });

  it('shows a localised empty line instead of a diagram block', () => {
    const markdown = buildDeliveryStatusReport({
      projectName: 'Lab',
      projectSlug: 'lab',
      projectStatus: 'active',
      milestones: [{ title: 'Undated', status: 'planned', targetDate: null }],
      tasks: [task({ title: 'No due date', dueDate: null })],
      diagrams: {
        orgHierarchy: false,
        raidBreakdown: false,
        deliveryTimeline: true,
        budgetBurndown: false,
      },
      diagramLabels: {
        deliveryTimeline: 'Delivery timeline',
        milestonesSection: 'Milestones',
        tasksSection: 'Tasks',
      },
      labels: {
        title: 'Delivery',
        generated: 'Generated',
        timelineRag: 'Timeline',
        timelineRagValue: 'On track',
        milestones: 'Milestones',
        tasks: 'Tasks',
        none: 'None',
        forecastHours: 'Forecast hours',
        actualHours: 'Actual hours',
        diagramEmpty: 'No data for this diagram.',
      },
    });
    expect(markdown).toContain('### Delivery timeline');
    expect(markdown).toContain('No data for this diagram.');
    expect(markdown).not.toContain('```mermaid');
  });
});

describe.skipIf(!chromeBin && !requireMermaidRender)(
  'mermaid render validation (skipped without Chrome; set MERMAID_RENDER_TEST=1 to require it)',
  () => {
  it('renders every builder and rejects the old gantt label', async (ctx) => {
    if (!chromeBin) {
      throw new Error(
        'MERMAID_RENDER_TEST=1 but no Chrome or Chromium executable was found. Set CHROME_PATH.',
      );
    }
    const milestones: ReportMilestone[] = [
      {
        title: REGRESSION_TITLES[2],
        status: 'active',
        targetDate: '2026-10-20',
      },
    ];
    const tasks = REGRESSION_TITLES.map((title, index) =>
      task({
        title,
        status: index === 1 ? 'done' : 'todo',
        dueDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
      }),
    );
    const gantt = unwrapMermaid(
      buildDeliveryTimelineMermaid({
        milestones,
        tasks,
        milestonesSection: 'Milestones',
        tasksSection: 'Tasks',
      }),
    );
    const flowchart = unwrapMermaid(
      buildOrgHierarchyMermaid([
        stakeholder({
          displayName: 'Lead: "A" & B; #1 [ops] (HU) – Übernahme',
          userId: '11111111-1111-1111-1111-111111111111',
        }),
        stakeholder({
          displayName: 'árvíztűrő: reports',
          userId: '22222222-2222-2222-2222-222222222222',
          reportsToUserId: '11111111-1111-1111-1111-111111111111',
        }),
      ]),
    );
    const pie = unwrapMermaid(
      buildRaidBreakdownMermaid(
        [
          { kind: 'risk', title: 'R', status: 'open', severity: 'high' },
          {
            kind: 'issue: "x"; #1',
            title: 'I',
            status: 'open',
            severity: 'critical',
          },
        ],
        (kind) => kind,
      ),
    );
    const budget: ReportBudgetSummary = {
      currency: 'EUR',
      initialBudget: null,
      approvedBudget: null,
      bac: 10,
      pv: 8,
      ev: 6,
      ac: 7,
      cpi: null,
      spi: null,
      financialRag: 'green',
      riskRag: 'green',
    };
    const xychart = unwrapMermaid(buildBudgetBurndownMermaid(budget));
    const legacy = [
      'gantt',
      '  dateFormat YYYY-MM-DD',
      '  section Tasks',
      `  ${legacyMermaidLabel(REGRESSION_TITLES[0])} :t0, 2026-10-01, 1d`,
      `  ${legacyMermaidLabel(REGRESSION_TITLES[1])} :done, t1, 2026-10-02, 1d`,
      `  ${legacyMermaidLabel(REGRESSION_TITLES[2])} :t2, 2026-10-03, 1d`,
    ].join('\n');

    let results: Array<{ ok: boolean; error: string | null }>;
    try {
      results = await renderMermaidInChrome(chromeBin, [
        gantt,
        flowchart,
        pie,
        xychart,
        legacy,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!requireMermaidRender && message.startsWith('Chrome did not start')) {
        ctx.skip(
          `Chrome failed to launch (${chromeBin}). ${message} Set MERMAID_RENDER_TEST=1 to fail instead of skip.`,
        );
      }
      throw error;
    }
    expect(results, JSON.stringify(results)).toHaveLength(5);
    expect(results[0]).toEqual({ ok: true, error: null });
    expect(results[1]).toEqual({ ok: true, error: null });
    expect(results[2]).toEqual({ ok: true, error: null });
    expect(results[3]).toEqual({ ok: true, error: null });
    expect(results[4]?.ok).toBe(false);
    expect(results[4]?.error ?? '').toMatch(/reading 'type'/);
  }, 60_000);
  },
);
