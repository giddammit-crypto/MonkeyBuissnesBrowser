#!/usr/bin/env python3
"""Download only locked patch inputs (~300KB); verify exact hashes and applicability."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
from native import PIN, ROOT


def verify(root):
    for name, digest in PIN['source_sha256'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Unexpected upstream content: ' + name)
    subprocess.run(['git', 'apply', '--check', str(ROOT / 'patches/0001-preview-branding.patch')], cwd=root, check=True)
    print(json.dumps({'upstream': PIN['commit'], 'patch_check': 'passed', 'compile': 'not_run', 'google_login': 'not_tested'}))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, help='Offline fixture directory with exact upstream files')
    args = p.parse_args()
    if args.source:
        verify(args.source.resolve()); return
    with tempfile.TemporaryDirectory(prefix='soulm8te-upstream-') as folder:
        root = Path(folder)
        for name in PIN['source_sha256']:
            url = 'https://raw.githubusercontent.com/chromium/chromium/' + PIN['commit'] + '/' + name
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read(2 * 1024 * 1024)
            target = root / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        verify(root)


if __name__ == '__main__': main()
