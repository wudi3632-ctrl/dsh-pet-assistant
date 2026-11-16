/**
 * 语音音色的唯一真相：白名单、展示元数据与默认值。
 *
 * 请求体里的 `voice` 只接受这里列出的 id——不接受任意音色串，否则等于把上游的能力面
 * 全部开放，出问题也说不清是谁传的。列表接口与校验都读同一个常量，不写第二份。
 * @module dsh-pet/src/host/voice/voices
 */

/** 一个可选音色；`id` 是 edge 服务端的 short name，其余字段只用于展示。 */
export interface VoiceInfo {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly default: boolean;
}

/** 本地授权声线；插件不再暴露 Edge 在线音色。 */
export const VOICES: readonly VoiceInfo[] = [
  { id: 'self-cute-v1', name: '自录萝莉声线', tag: '女 · 甜美 · 本地 CosyVoice3', default: true },
];

/** 默认音色 id；请求与配置都没指定时用它，必须与 {@link VOICES} 里 `default` 标记的那个一致。 */
export const DEFAULT_VOICE = 'self-cute-v1';

/**
 * 判断音色是否在白名单内。
 * @param id - 待校验的音色 id。
 * @returns 属于白名单时为 true。
 */
export function isKnownVoice(id: string): boolean {
  return VOICES.some((voice) => voice.id === id);
}
