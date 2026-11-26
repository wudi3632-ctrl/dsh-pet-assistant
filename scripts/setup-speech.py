"""Prepare isolated Windows ASR/KWS. No global pip, microphone or host changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

def install_archive(archive, destination, model):
    """Select known basenames only; never extract archive paths or links."""
    destination.mkdir(parents=True, exist_ok=True)
    found = set()
    with tarfile.open(archive, 'r:bz2') as bundle:
        for member in bundle:
            name = Path(member.name).name
            if name not in model['files']:
                continue
            if not member.isfile() or name in found:
                raise ValueError('模型包中有重复文件或链接: ' + name)
            spec = model['files'][name]
            if member.size != spec['bytes']:
                raise ValueError('模型文件大小不匹配: ' + name)
            temporary = destination / (name + '.part')
            with bundle.extractfile(member) as source, temporary.open('wb') as target:
                shutil.copyfileobj(source, target)
            if digest(temporary) != spec['sha256']:
                raise ValueError('模型SHA256不匹配: ' + name)
            os.replace(temporary, destination / name)
            found.add(name)
    if found != set(model['files']):
        raise ValueError('模型包缺少文件: ' + ', '.join(set(model['files']) - found))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=PROJECT / '.runtime' / 'speech')
    parser.add_argument('--asr-archive', type=Path)
    parser.add_argument('--kws-archive', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--models-only', action='store_true', help='仅准备模型，不安装Python依赖/修改设置')
    args = parser.parse_args()
    models = json.loads((PROJECT / 'speech/models.json').read_text('utf-8'))
    root = args.root.resolve()
    if args.dry_run:
        print(json.dumps({'root': str(root), 'models': models, 'pythonPackages': ['numpy==2.2.6', 'sherpa-onnx==2.0.1'], 'changesGlobalPython': False}, ensure_ascii=False, indent=2))
        return
    if os.name != 'nt' or not (3, 10) <= sys.version_info[:2] <= (3, 12):
        raise RuntimeError('请使用Windows 64位Python 3.10、3.11或3.12运行；推荐 py -3.11 scripts/setup-speech.py')
    root.mkdir(parents=True, exist_ok=True)
    for model in models:
        destination = root / model['directory']
        if all((destination / name).is_file() and digest(destination / name) == spec['sha256'] for name, spec in model['files'].items()):
            print('复用已验证模型: ' + model['id'], flush=True)
            continue
        supplied = getattr(args, model['id'] + '_archive')
        with tempfile.TemporaryDirectory(prefix='download-', dir=root) as temporary:
            archive = supplied.resolve() if supplied else Path(temporary) / 'model.tar.bz2'
            if not supplied:
                print('下载 ' + model['url'], flush=True)
                request = urllib.request.Request(model['url'], headers={'User-Agent': 'dsh-dashifeiyu-pet-setup'})
                with urllib.request.urlopen(request, timeout=90) as response, archive.open('wb') as target:
                    shutil.copyfileobj(response, target, 1024 * 1024)
            if model.get('archiveSha256') and digest(archive) != model['archiveSha256']:
                raise ValueError('模型压缩包SHA256不匹配: ' + model['id'])
            install_archive(archive, destination, model)
    if args.models_only:
        return
    python = root / '.venv/Scripts/python.exe'
    if not python.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(root / '.venv')], check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', 'numpy==2.2.6', 'sherpa-onnx==2.0.1'], check=True)
    subprocess.run([str(python), '-c', 'import numpy,sherpa_onnx; print("Python语音依赖就绪")'], check=True)
    path = PROJECT / 'settings.local.json'
    settings = json.loads(path.read_text('utf-8')) if path.exists() else {}
    if path.exists():
        import time
        shutil.copy2(path, str(path) + '.before-speech-' + str(time.time_ns()) + '.bak')
    settings['speech'] = {'root': str(root), 'python': str(python)}
    path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print('语音环境已准备。请重新启用DSH桌宠插件，再在设置中开启麦克风。')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('准备失败: ' + str(error) + '\n可先下载官方模型压缩包，再用 --asr-archive / --kws-archive 指定；不会删除已有模型。', file=sys.stderr)
        sys.exit(1)
