import test from 'node:test';import assert from 'node:assert/strict';
import {spokenReport} from '../public/reply-text.mjs';
import {taskWithReport} from '../backends/report.mjs';
test('spoken report preserves failure and approval, skips long details without claiming success',()=>{
 assert.equal(spokenReport('完整说明'.repeat(100)+'\n桌宠简报：没有打开微信，请在 DSH 中确认权限。'),'没有打开微信，请在 DSH 中确认权限。');
 assert.equal(spokenReport('已创建文件。'),'已创建文件。');
 assert.equal(spokenReport('完成部分步骤。\n'+'但是失败。'.repeat(40)),'DSH 已返回处理结果，详细内容请查看会话。');
 assert.equal(spokenReport('```powershell\nRemove-Item C:\\secret\n```'),'DSH 已返回处理结果，详细内容请查看会话。');
 assert.equal(spokenReport('桌宠简报：'+ '长'.repeat(101)),'DSH 已返回处理结果，详细内容请查看会话。');
});
test('same-turn report instruction retains original task and protocol length boundary',()=>{
 assert.ok(taskWithReport('打开记事本').startsWith('打开记事本\n\n'));
 assert.match(taskWithReport('打开记事本'),/未完成、失败或待确认/);
 const long='字'.repeat(2000);assert.equal(taskWithReport(long),long);
});
