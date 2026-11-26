import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / relative)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

setup = load('speech_setup', 'scripts/setup-speech.py')
qwen = load('portable_qwen', 'speech/qwen-server.py')

class SetupTests(unittest.TestCase):
    def model(self):
        return {'files': {'tokens.txt': {'bytes': 4, 'sha256': hashlib.sha256(b'test').hexdigest()}}}

    def archive(self, path, data=b'test', link=False):
        with tarfile.open(path, 'w:bz2') as bundle:
            member = tarfile.TarInfo('../../tokens.txt'); member.size = len(data)
            if link: member.type = tarfile.SYMTYPE; member.linkname = '../../outside'
            bundle.addfile(member, io.BytesIO(data) if not link else None)

    def test_extract_only_safe_known_basename(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.archive(root / 'model.tar.bz2')
            setup.install_archive(root / 'model.tar.bz2', root / 'models', self.model())
            self.assertEqual((root / 'models/tokens.txt').read_bytes(), b'test')
            self.assertFalse((root / 'tokens.txt').exists())

    def test_hash_mismatch_does_not_overwrite_valid_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'models').mkdir(); (root / 'models/tokens.txt').write_bytes(b'original')
            self.archive(root / 'model.tar.bz2', b'fail')
            with self.assertRaises(ValueError): setup.install_archive(root / 'model.tar.bz2', root / 'models', self.model())
            self.assertEqual((root / 'models/tokens.txt').read_bytes(), b'original')

    def test_reject_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.archive(root / 'model.tar.bz2', link=True)
            with self.assertRaises(ValueError): setup.install_archive(root / 'model.tar.bz2', root / 'models', self.model())

    def test_tts_rejects_empty_and_unknown_voice(self):
        for payload in ({'text': ''}, {'text': '测试', 'voice': 'private'}, []):
            with self.assertRaises(ValueError): qwen.validate(payload, {'default': {}})
        self.assertEqual(qwen.validate({'text': '你好'}, {'default': {}}), ('你好', 'default'))

if __name__ == '__main__': unittest.main()
