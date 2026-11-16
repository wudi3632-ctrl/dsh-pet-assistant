/** 桌宠一句话的统一表演参数：文字、TTS 和动作都以它为准。 */

export const PET_EMOTIONS = ['neutral', 'happy', 'gentle', 'sad', 'angry', 'serious'] as const;
export const PET_SPEEDS = ['slow', 'normal', 'fast'] as const;
export const PET_TAGS = ['', '[laughter]', '[sigh]', '[mn]'] as const;

export type PetEmotion = (typeof PET_EMOTIONS)[number];
export type PetSpeed = (typeof PET_SPEEDS)[number];
export type PetVoiceTag = (typeof PET_TAGS)[number];

export interface PetPerformance {
  readonly emotion: PetEmotion;
  readonly speed: PetSpeed;
  readonly tag: PetVoiceTag;
}

export const NEUTRAL_PERFORMANCE: PetPerformance = { emotion: 'neutral', speed: 'normal', tag: '' };

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);

/** 从不可信数据中读取表演参数；旧记录和非法值都安全回到中性。 */
export function performanceOf(raw: unknown): PetPerformance {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    emotion: isOneOf(value.emotion, PET_EMOTIONS) ? value.emotion : 'neutral',
    speed: isOneOf(value.speed, PET_SPEEDS) ? value.speed : 'normal',
    tag: isOneOf(value.tag, PET_TAGS) ? value.tag : '',
  };
}

/** 模型漏写控制标记时的本地兜底。只看最终回答，保证声音至少不与字面语义相反。 */
export function inferPerformance(text: string): PetPerformance {
  const body = text.trim();
  if (/(生气|气死|讨厌|不许|住手|过分|哼[！!]?|绝对不行)/u.test(body)) {
    return { emotion: 'angry', speed: 'fast', tag: '' };
  }
  if (/(难过|伤心|委屈|对不起|抱歉|想哭|呜呜|没关系.*陪|失去|离开了)/u.test(body)) {
    return { emotion: 'sad', speed: 'slow', tag: '[sigh]' };
  }
  if (/(别怕|乖|慢慢来|陪着你|抱抱|早点休息|晚安|辛苦了|没事的)/u.test(body)) {
    return { emotion: 'gentle', speed: 'slow', tag: '' };
  }
  if (/(注意|必须|需要|首先|其次|危险|重要|认真|建议|不能)/u.test(body)) {
    return { emotion: 'serious', speed: 'normal', tag: '' };
  }
  if (/(开心|太好啦|好耶|真棒|恭喜|哈哈|嘿嘿|欢迎|喜欢|加油|！|!)/u.test(body)) {
    return { emotion: 'happy', speed: 'fast', tag: /哈哈|嘿嘿/u.test(body) ? '[laughter]' : '' };
  }
  return NEUTRAL_PERFORMANCE;
}
