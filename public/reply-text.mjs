// Host formatting is not speech. Keep the same plain text for subtitles and TTS.
export function replyText(value) {
  return String(value||'')
    .replace(/<\/?(?:data|file|result)>/gi,'')
    .replace(/^```[^\n]*$/gm,'')
    .replace(/\[([^\]\n]+)\]\([^\n)]+\)/g,'$1')
    .replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/`([^`\n]+)`/g,'$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm,'')
    .replace(/^\s*[-*]\s+/gm,'')
    .trim();
}

// One short report from the same DSH turn; never infer success by truncating details.
export function spokenReport(value) {
  const source=String(value||'');
  const matches=[...source.matchAll(/^\s*(?:#{1,6}\s*)?桌宠简报[：:]\s*([^\n]+)\s*$/gm)];
  const summary=matches.at(-1)?.[1];
  if(summary){
    const clean=replyText(summary);
    if(Array.from(clean).length<=100&&!/https?:|[A-Z]:\\|```/i.test(clean))return clean;
  }
  const plain=replyText(source);
  if(plain&&Array.from(plain).length<=100&&!/```|https?:|[A-Z]:\\/i.test(source))return plain;
  return 'DSH 已返回处理结果，详细内容请查看会话。';
}
