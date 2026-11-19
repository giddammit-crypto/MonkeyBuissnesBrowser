import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'native.py'
spec = importlib.util.spec_from_file_location('native', MODULE)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeTests(unittest.TestCase):
    def test_urls_are_not_command_line_switches(self):
        for url in ('--no-sandbox', 'javascript:alert(1)', 'file:///etc/passwd', 'https://u:p@site.test', 'chrome://flags'):
            with self.assertRaises(ValueError): native.launch_command(Path('/bin/chrome'), Path('/tmp/profile'), url)
        command = native.launch_command(Path('/bin/chrome'), Path('/tmp/profile with spaces'), 'https://accounts.google.com/')
        self.assertEqual(command[-1], 'https://accounts.google.com/')
        self.assertIn('--user-data-dir=/tmp/profile with spaces', command)
        self.assertFalse(any('remote-debugging' in x or 'no-sandbox' in x or 'disable-web-security' in x for x in command))

    def test_doctor_reports_missing_space_without_downloading(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native.shutil, 'disk_usage') as usage:
            usage.return_value.free = 59 * native.GIB
            self.assertFalse(native.doctor(Path(d))['ready'])
            with patch.object(native, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError): native.prepare(Path(d))
                run.assert_not_called()

    def test_incremental_build_reaches_revision_check_on_populated_disk(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native.shutil, 'disk_usage') as usage:
            usage.return_value.free = 59 * native.GIB
            with patch.object(native, 'verify_source', side_effect=ValueError('revision check')) as verify:
                with self.assertRaisesRegex(ValueError, 'revision check'):
                    native.build(Path(d), jobs=1)
                verify.assert_called_once_with(Path(d).resolve() / 'src')

    def test_large_binary_digest_matches_standard_sha256(self):
        with tempfile.TemporaryDirectory() as d:
            binary = Path(d) / 'chrome'
            data = bytes(range(256)) * 10001
            binary.write_bytes(data)
            self.assertEqual(native.binary_sha256(binary), native.hashlib.sha256(data).hexdigest())

    def test_existing_workspace_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native, 'require_resources'):
            p = Path(d) / 'important.txt'; p.write_text('keep me')
            with self.assertRaises(ValueError): native.prepare(Path(d))
            self.assertEqual(p.read_text(), 'keep me')

    def test_wrong_revision_is_rejected_before_patch(self):
        with patch.object(native, 'output', return_value='different'), patch.object(native, 'run') as run:
            with self.assertRaises(ValueError): native.apply_branding(Path('/tmp/not-source'))
            run.assert_not_called()

    def test_modified_source_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native, 'verify_source'), patch.object(native, 'run') as run:
            root = Path(d)
            for name in native.PIN['source_sha256']:
                p = root / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('local edit')
            with self.assertRaises(ValueError): native.apply_branding(root)
            run.assert_not_called()
            self.assertEqual(p.read_text(), 'local edit')

    def test_baseline_and_fork_use_distinct_profiles(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native, 'output', return_value='Chromium 156.0.8078.79'), patch.dict(native.os.environ, {'XDG_CONFIG_HOME': d}):
            binary = Path(d) / 'chrome'; binary.write_text('test only'); binary.chmod(0o700)
            evidence = {'upstream': native.PIN['commit'], 'binary_sha256': native.hashlib.sha256(binary.read_bytes()).hexdigest()}
            (binary.parent / 'soulm8te-build.json').write_text(json.dumps(evidence))
            commands = []
            for mode in ('baseline', 'fork'):
                out = io.StringIO()
                with contextlib.redirect_stdout(out): native.launch(binary, mode, 'about:blank', True)
                commands.append(json.loads(out.getvalue())['command'])
            self.assertNotEqual(commands[0][1], commands[1][1])
            self.assertFalse((Path(d) / 'soulm8te-chromium-baseline').exists())

    def test_profile_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native, 'output', return_value='Chromium 156.0.8078.79'), patch.dict(native.os.environ, {'XDG_CONFIG_HOME': d}):
            binary = Path(d) / 'chrome'; binary.touch(); binary.chmod(0o700)
            (Path(d) / 'soulm8te-chromium-baseline').symlink_to(Path(d), target_is_directory=True)
            with self.assertRaises(ValueError): native.launch(binary, 'baseline', 'about:blank', True)

    def test_electron_is_not_a_fallback(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native, 'output', return_value='v45.0.0'):
            binary = Path(d) / 'electron'; binary.touch(); binary.chmod(0o700)
            with self.assertRaises(ValueError): native.launch(binary, 'baseline', 'about:blank', True)

    def test_mismatched_fork_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as d, patch.object(native, 'output', return_value='Chromium 156.0.8078.79'):
            binary = Path(d) / 'chrome'; binary.touch(); binary.chmod(0o700)
            (binary.parent / 'soulm8te-build.json').write_text(json.dumps({'upstream': native.PIN['commit'], 'binary_sha256': 'wrong'}))
            with self.assertRaises(ValueError): native.launch(binary, 'fork', 'about:blank', True)


if __name__ == '__main__': unittest.main()
