#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

export const STAGE_ORDER = [
  'speech-start', 'speech-end', 'asr-request', 'asr-result', 'wake-match', 'chat-start',
  'chat-host-start', 'llm-request', 'llm-first-token', 'llm-complete', 'memory-written',
  'state-published', 'bubble-visible', 'tts-request', 'tts-queued', 'tts-host-open',
  'tts-open', 'prebuffer', 'pcm-first-frame', 'audio-scheduled', 'first-audible', 'playback-complete',
  'barge-in', 'playback-cancel-requested', 'playback-cancelled',
];

export function parseTraceLines(raw, traceId) {
  const events = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const marker = '[dsh-pet-trace] ';
    const at = line.indexOf(marker);
    if (at < 0) continue;
    try {
      const event = JSON.parse(line.slice(at + marker.length));
      if (event?.traceId === traceId && typeof event.stage === 'string') events.push(event);
    } catch { /* incomplete log line */ }
  }
  return events.sort((a, b) => (a.wallMs ?? 0) - (b.wallMs ?? 0));
}

export function buildReport(traceId, events, cosy = null) {
  const firstWall = events.find((event) => Number.isFinite(event.wallMs))?.wallMs ?? null;
  const lastWall = [...events].reverse().find((event) => Number.isFinite(event.wallMs))?.wallMs ?? null;
  const total = firstWall === null || lastWall === null ? null : Math.max(0, lastWall - firstWall);
  const byStage = new Map();
  for (const event of events) if (!byStage.has(event.stage)) byStage.set(event.stage, event);
  let previous = firstWall;
  const rows = STAGE_ORDER.map((stage) => {
    const event = byStage.get(stage);
    if (!event || !Number.isFinite(event.wallMs) || firstWall === null) {
      return { stage, observed: false, offsetMs: null, deltaMs: null, percent: null };
    }
    const deltaMs = previous === null ? 0 : Math.max(0, event.wallMs - previous);
    previous = event.wallMs;
    return {
      stage, observed: true, wallMs: event.wallMs, offsetMs: event.wallMs - firstWall, deltaMs,
      percent: total && total > 0 ? Number((deltaMs / total * 100).toFixed(2)) : null,
      details: Object.fromEntries(Object.entries(event).filter(([key]) => !['traceId', 'stage', 'wallMs'].includes(key))),
    };
  });
  return { traceId, generatedAt: new Date().toISOString(), totalMs: total, rows, cosy };
}

export function reportMarkdown(report) {
  const lines = [
    `# Voice trace ${report.traceId}`,
    '',
    `- End-to-end observed: ${report.totalMs ?? 'not_observed'} ms`,
    `- Generated: ${report.generatedAt}`,
    '',
    '| Stage | Observed | Offset ms | Delta ms | Share | Details |',
    '|---|---:|---:|---:|---:|---|',
  ];
  for (const row of report.rows) {
    lines.push(`| ${row.stage} | ${row.observed ? 'yes' : 'not_observed'} | ${row.offsetMs ?? '-'} | ${row.deltaMs ?? '-'} | ${row.percent === null ? '-' : row.percent + '%'} | ${row.details ? JSON.stringify(row.details).replaceAll('|', '\\|') : ''} |`);
  }
  if (report.cosy) {
    lines.push('', '## CosyVoice internal stages', '', '```json', JSON.stringify(report.cosy, null, 2), '```');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
  }));
  if (typeof args.trace !== 'string' || typeof args.log !== 'string') {
    throw new Error('usage: node scripts/voice-trace-report.mjs --trace=<id> --log=<path> [--out=<path>]');
  }
  const logPath = args.log;
  const raw = await readFile(logPath, 'utf8');
  let cosy = null;
  try {
    const health = await (await fetch('http://127.0.0.1:9882/health')).json();
    if (health?.last_trace?.trace_id === args.trace) cosy = health.last_trace;
  } catch { /* service unavailable: report marks it absent */ }
  const report = buildReport(args.trace, parseTraceLines(raw, args.trace), cosy);
  const markdown = reportMarkdown(report);
  if (typeof args.out === 'string') {
    await writeFile(args.out, markdown, 'utf8');
    await writeFile(args.out.replace(/\.md$/i, '') + '.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  process.stdout.write(markdown);
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replaceAll('\\', '/')}`).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
