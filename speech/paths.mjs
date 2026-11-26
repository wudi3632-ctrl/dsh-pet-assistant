import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
export const speechFiles=[
 'streaming-paraformer-bilingual-int8/tokens.txt',
 'streaming-paraformer-bilingual-int8/encoder.int8.onnx',
 'streaming-paraformer-bilingual-int8/decoder.int8.onnx',
 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/tokens.txt',
 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
];
export function speechPaths(project,settings={},env=process.env){
 const portable=resolve(project,'.runtime/speech');
 const root=resolve(env.DFY_ASR_ROOT||settings.speech?.root||(existsSync(resolve(portable,'.venv/Scripts/python.exe'))?portable:resolve(project,'../speech-models/sherpa-onnx')));
 const python=resolve(env.DFY_ASR_PYTHON||settings.speech?.python||resolve(root,'.venv/Scripts/python.exe'));
 const missing=[python,...speechFiles.map(f=>resolve(root,f))].filter(p=>!existsSync(p));
 return {root,python,missing,available:missing.length===0};
}
