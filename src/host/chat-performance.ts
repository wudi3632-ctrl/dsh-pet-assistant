/** LLM 回复里的隐藏表演标记：同一次生成同时决定文字、声音情绪和动作。 */
import {
  PET_EMOTIONS,
  PET_SPEEDS,
  PET_TAGS,
  inferPerformance,
  type PetPerformance,
} from '../shared/performance.ts';

export function performanceInstruction(): string {
  return (
    '\n\n[表演] 你必须根据这次回复真正表达的情绪，在回复最后另起一行输出一个隐藏控制标记：' +
    '\n[情绪:neutral;语速:normal;语气:none]' +
    '\n情绪只能选 neutral/happy/gentle/sad/angry/serious；语速只能选 slow/normal/fast；语气只能选 none/laughter/sigh/mn。' +
    '\n开心可稍快，安慰和难过宜慢，严肃保持清楚；不要为了可爱而把难过、生气或严肃内容读成开心。' +
    '\n语气词只在自然时使用，不要每句都笑或叹气。这个标记不会显示给用户。' +
    '\n[执行真实性] 除非本轮系统提示明确包含 Windows 操作规划协议，否则你没有操作电脑。不得声称“正在打开、已经搜索、已经写好、这就发送”或暗示任务已执行；应明确说明尚未执行并请用户改为具体指令。'
  );
}

export function extractPerformance(text: string): { text: string; performance: PetPerformance } {
  const tag = /\[情绪[:：]\s*([^;\]\n]+)\s*;\s*语速[:：]\s*([^;\]\n]+)\s*;\s*语气[:：]\s*([^\]\n]+)\s*\]/giu;
  let selected: PetPerformance | undefined;
  let tagged = false;
  const cleaned = text.replace(tag, (_whole, emotionRaw: string, speedRaw: string, tagRaw: string) => {
    tagged = true;
    const emotion = emotionRaw.trim().toLowerCase();
    const speed = speedRaw.trim().toLowerCase();
    const spoken = tagRaw.trim().toLowerCase();
    const voiceTag = spoken === 'none' ? '' : `[${spoken}]`;
    if (
      selected === undefined &&
      PET_EMOTIONS.includes(emotion as never) &&
      PET_SPEEDS.includes(speed as never) &&
      PET_TAGS.includes(voiceTag as never)
    ) {
      selected = { emotion: emotion as PetPerformance['emotion'], speed: speed as PetPerformance['speed'], tag: voiceTag as PetPerformance['tag'] };
    }
    return '';
  });
  const body = (tagged ? cleaned.replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim() : text).trim();
  return { text: body, performance: selected ?? inferPerformance(body) };
}
