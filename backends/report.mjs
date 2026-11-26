const instruction='\n\n[桌宠输出要求]在DSH会话保留必要的完整结果；最后单独一行写“桌宠简报：”及不超过80字的一到两句自然中文口播。说明实际结果，未完成、失败或待确认必须明确说出。简报不要代码、路径或链接。不为生成简报额外调用模型。';
export function taskWithReport(text){
  // Preserve the complete user command at the protocol's input length boundary.
  return text.length+instruction.length<=2000?text+instruction:text;
}
