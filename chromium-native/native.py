#!/usr/bin/env python3
"""Explicit Linux Chromium migration tooling; never runs Electron or disables sandbox."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PIN = json.loads((ROOT / 'upstream.json').read_text())
OUT = 'out/Soulm8te'
GIB = 1024 ** 3


def run(args, cwd=None, env=None):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def output(args, cwd=None):
    return subprocess.check_output(list(map(str, args)), cwd=cwd, text=True).strip()


def doctor(workspace):
    parent = workspace.resolve()
    while not parent.exists():
        parent = parent.parent
    free = shutil.disk_usage(parent).free
    ram = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    return {'platform': platform.system(), 'machine': platform.machine(),
            'free_gib': round(free / GIB, 1), 'ram_gib': round(ram / GIB, 1),
            'required_free_gib': 100, 'required_ram_gib': 8,
            'ready': platform.system() == 'Linux' and platform.machine() in ('x86_64', 'amd64')
                     and free >= 100 * GIB and ram >= 8 * GIB,
            'chromium_compile': 'not_run', 'google_login': 'not_tested'}


def require_resources(workspace):
    report = doctor(workspace)
    print(json.dumps(report, indent=2))
    if not report['ready']:
        raise ValueError('Build needs Linux x86_64, >=100 GiB free and >=8 GiB RAM (16+ recommended).')


def verify_source(src):
    if output(['git', 'rev-parse', 'HEAD'], src) != PIN['commit']:
        raise ValueError('Checkout does not match upstream.json; do not apply patches to another revision.')


def apply_branding(src):
    verify_source(src)
    patch = ROOT / 'patches/0001-preview-branding.patch'
    actual = {name: hashlib.sha256((src / name).read_bytes()).hexdigest() for name in PIN['source_sha256']}
    if actual == PIN['patched_sha256']:
        return  # Resume a failed build only with the exact reviewed patch.
    if actual != PIN['source_sha256']:
        raise ValueError('Upstream files have local edits or a partial/unknown patch.')
    run(['git', 'apply', '--check', patch], src)
    run(['git', 'apply', patch], src)


def prepare(workspace):
    require_resources(workspace)
    workspace = workspace.resolve()
    if any(char.isspace() for char in str(workspace)):
        raise ValueError('Chromium checkout path must not contain whitespace.')
    if workspace.exists() and any(workspace.iterdir()):
        raise ValueError('Prepare requires an empty workspace. Existing checkouts are never reset.')
    if not shutil.which('fetch') or not shutil.which('gclient'):
        raise ValueError('Install depot_tools and place it on PATH; see README.md.')
    workspace.mkdir(parents=True, exist_ok=True)
    run(['fetch', '--nohooks', '--no-history', 'chromium'], workspace)
    src = workspace / 'src'
    run(['git', 'fetch', '--depth=1', 'origin', PIN['tag']], src)
    # FETCH_HEAD must be the reviewed pin, not a changed tag.
    if output(['git', 'rev-parse', 'FETCH_HEAD'], src) != PIN['commit']:
        raise ValueError('Upstream tag moved: refusing to build an unreviewed revision.')
    run(['git', 'checkout', '--detach', PIN['commit']], src)
    run(['gclient', 'sync', '--nohooks', '--revision', 'src@' + PIN['commit']], workspace)
    verify_source(src)
    print('Source ready. Install build dependencies as documented, then run build.')


def build(workspace, jobs):
    require_resources(workspace)
    src = workspace.resolve() / 'src'
    verify_source(src)
    changed = set(filter(None, output(['git', 'diff', '--name-only', 'HEAD'], src).splitlines()))
    if changed - set(PIN['source_sha256']):
        raise ValueError('Checkout has unrelated tracked edits; refusing to overwrite or build them.')
    for tool in ('gclient', 'gn', 'autoninja'):
        if not shutil.which(tool):
            raise ValueError(f'Missing {tool}; install depot_tools and system build dependencies.')
    run(['gclient', 'runhooks'], src)
    apply_branding(src)
    out = src / OUT
    out.mkdir(parents=True, exist_ok=True)
    (out / 'args.gn').write_bytes((ROOT / 'args.gn').read_bytes())
    run(['gn', 'gen', OUT, '--fail-on-unused-args'], src)
    run(['autoninja', '-C', OUT, '-j', str(jobs), 'chrome'], src)
    binary = out / 'chrome'
    if not binary.is_file():
        raise ValueError('Build produced no chrome binary.')
    evidence = {'upstream': PIN['commit'], 'version': PIN['version'],
                'target': '//chrome', 'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
                'compile': 'passed', 'google_login': 'not_tested', 'migration': 'prototype_only'}
    (out / 'soulm8te-build.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print('Compiled prototype:', binary)


def launch_command(binary, profile, url):
    parsed = urlsplit(url)
    if not ((parsed.scheme in ('https', 'http') and parsed.hostname and not parsed.username and not parsed.password)
            or url in ('about:blank', 'chrome://version', 'chrome://sandbox')):
        raise ValueError('Only ordinary HTTP(S) URLs, about:blank, chrome://version/sandbox are accepted.')
    return [str(binary.resolve()), '--user-data-dir=' + str(profile.resolve()),
            '--no-first-run', '--no-default-browser-check', url]


def launch(binary, mode, url, dry_run=False):
    binary = binary.resolve()
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError('Provide an executable Chromium browser via --binary; no automatic Electron fallback.')
    version = output([binary, '--version'])
    if not any(line.startswith(('Chromium ', 'soulm8te Preview ')) for line in version.splitlines()):
        raise ValueError('Binary does not identify as Chromium or soulm8te Preview.')
    config = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))
    if not config.is_absolute():
        raise ValueError('XDG_CONFIG_HOME must be absolute.')
    profile = config / ('soulm8te-chromium-baseline' if mode == 'baseline' else 'soulm8te-chromium-preview')
    if mode == 'fork':
        evidence = json.loads((binary.parent / 'soulm8te-build.json').read_text())
        if evidence.get('upstream') != PIN['commit'] or evidence.get('binary_sha256') != hashlib.sha256(binary.read_bytes()).hexdigest():
            raise ValueError('Fork build evidence does not match this binary.')
    if profile.is_symlink():
        raise ValueError('Dedicated preview profile must not be a symlink to another browser profile.')
    cmd = launch_command(binary, profile, url)
    print(json.dumps({'mode': mode, 'version': version, 'command': cmd,
                      'google_login': 'manual_test_required'}, indent=2))
    if dry_run:
        return
    if os.geteuid() == 0:
        raise ValueError('Run as a normal desktop user. This launcher never disables the sandbox.')
    profile.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Official Chromium docs distinguish web login from restricted Chrome Sync.
    env = dict(os.environ)
    env.pop('GOOGLE_DEFAULT_CLIENT_ID', None)
    env.pop('GOOGLE_DEFAULT_CLIENT_SECRET', None)
    run(cmd, env=env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('doctor', 'prepare', 'build'):
        p = sub.add_parser(name)
        p.add_argument('--workspace', type=Path, required=True)
        if name == 'build':
            p.add_argument('--jobs', type=int, default=4)
    p = sub.add_parser('launch')
    p.add_argument('--binary', type=Path, required=True)
    p.add_argument('--mode', choices=('baseline', 'fork'), required=True)
    p.add_argument('--url', default='chrome://version')
    p.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'doctor':
            report = doctor(args.workspace)
            print(json.dumps(report, indent=2))
            return 0 if report['ready'] else 2
        if args.command == 'prepare': prepare(args.workspace)
        elif args.command == 'build':
            if args.jobs < 1: raise ValueError('jobs must be positive')
            build(args.workspace, args.jobs)
        elif args.command == 'launch': launch(args.binary, args.mode, args.url, args.dry_run)
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('ERROR:', error, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
