import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport, parseTraceLines, reportMarkdown } from './voice-trace-report.mjs';

test('parses only the selected privacy-safe trace and computes deltas', () => {
  const raw = [
    'x [dsh-pet-trace] {"traceId":"a","stage":"speech-start","wallMs":1000,"chars":2}',
    '[dsh-pet-trace] {"traceId":"b","stage":"speech-start","wallMs":1001}',
    '[dsh-pet-trace] {"traceId":"a","stage":"asr-result","wallMs":1250,"chars":4}',
  ].join('\n');
  const report = buildReport('a', parseTraceLines(raw, 'a'));
  assert.equal(report.totalMs, 250);
  assert.equal(report.rows.find((row) => row.stage === 'asr-result').deltaMs, 250);
  assert.match(reportMarkdown(report), /not_observed/);
  assert.doesNotMatch(JSON.stringify(report), /完整正文/);
});
