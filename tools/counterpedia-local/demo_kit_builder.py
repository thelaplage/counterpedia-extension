#!/usr/bin/env python3
"""Build a portable Counterpedia Demo Kit from exact local source checkouts.

Packaging only. This module copies tracked source snapshots and emits wrapper
launchers; it does not reimplement or reinterpret any Counterpedia capability.

The target bundle deliberately contains no .git directories, node_modules,
virtualenvs, user capture stores, logs, transport tokens, model keys, or other
machine-local state. Fresh runtimes are installed on the recipient Mac by the
bundle's installer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MANIFEST_SCHEMA = "counterpedia.demo_kit_manifest.v0.1"
COMPONENT_DIR = "components"
COMPONENTS = (
    ("counterpedia-extension", "thelaplage/counterpedia-extension"),
    ("counterpedia-acquisition", "thelaplage/counterpedia-acquisition"),
    ("counterpedia-authoring", "thelaplage/counterpedia-authoring"),
    ("counterpedia", "thelaplage/counterpedia"),
    ("counterpedia-console", "thelaplage/counterpedia-console"),
)

# Explicitly refuse machine-local / secret-looking tracked files. We copy only
# files known to git, but a secret can still be committed accidentally. Keep
# this list narrow enough not to reject ordinary fixtures or documentation.
_REFUSED_BASENAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".npmrc",
    ".pypirc",
}
_REFUSED_SUFFIXES = {".p12", ".pfx"}


class DemoKitBuildError(RuntimeError):
    pass


@dataclass(frozen=True)
class ComponentSnapshot:
    name: str
    repository: str
    source_dir: Path
    commit_sha: str
    tracked_file_count: int
    snapshot_sha256: str

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "repository": self.repository,
            "relative_path": f"{COMPONENT_DIR}/{self.name}",
            "commit_sha": self.commit_sha,
            "tracked_file_count": self.tracked_file_count,
            "snapshot_sha256": self.snapshot_sha256,
        }


def _run(command: list[str], *, cwd: Path | None = None) -> str:
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DemoKitBuildError(f"could not run {' '.join(command)}") from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise DemoKitBuildError(f"command failed: {' '.join(command)}: {detail}")
    return completed.stdout


def _git(repo: Path, *args: str) -> str:
    return _run(["git", "-C", str(repo), *args]).strip()


def _assert_source_checkout(repo: Path) -> str:
    repo = repo.resolve()
    if not repo.is_dir():
        raise DemoKitBuildError(f"source checkout does not exist: {repo}")
    inside = _git(repo, "rev-parse", "--is-inside-work-tree")
    if inside != "true":
        raise DemoKitBuildError(f"source is not a git worktree: {repo}")
    commit = _git(repo, "rev-parse", "HEAD")
    if len(commit) != 40:
        raise DemoKitBuildError(f"could not pin source commit for {repo}")

    # Tracked edits/staged edits are refused. Untracked files are deliberately
    # ignored because the builder copies git-tracked paths only.
    if subprocess.run(["git", "-C", str(repo), "diff", "--quiet"], check=False).returncode != 0:
        raise DemoKitBuildError(f"tracked working-tree changes present in {repo}")
    if subprocess.run(["git", "-C", str(repo), "diff", "--cached", "--quiet"], check=False).returncode != 0:
        raise DemoKitBuildError(f"staged changes present in {repo}")
    return commit


def _tracked_entries(repo: Path) -> list[tuple[str, str]]:
    """Return (git_mode, path) for every tracked path at HEAD."""
    raw = _run(["git", "-C", str(repo), "ls-files", "-s", "-z"]).encode("utf-8")
    entries: list[tuple[str, str]] = []
    for chunk in raw.split(b"\0"):
        if not chunk:
            continue
        try:
            left, path_b = chunk.split(b"\t", 1)
            mode = left.split(b" ", 1)[0].decode("ascii")
            path = path_b.decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise DemoKitBuildError(f"could not parse git tracked path in {repo}") from exc
        entries.append((mode, path))
    return entries


def _refuse_sensitive_path(relative: Path) -> None:
    name = relative.name
    if name in _REFUSED_BASENAMES:
        raise DemoKitBuildError(f"refusing secret/machine-local tracked file: {relative}")
    if relative.suffix.lower() in _REFUSED_SUFFIXES:
        raise DemoKitBuildError(f"refusing credential-container tracked file: {relative}")
    if any(part == ".git" for part in relative.parts):
        raise DemoKitBuildError(f"refusing .git path: {relative}")


def _safe_symlink_target(source_path: Path, root: Path) -> str:
    target = os.readlink(source_path)
    target_path = Path(target)
    if target_path.is_absolute():
        raise DemoKitBuildError(f"refusing absolute tracked symlink: {source_path}")
    resolved = (source_path.parent / target_path).resolve(strict=False)
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise DemoKitBuildError(f"refusing tracked symlink escaping source root: {source_path}") from exc
    return target


def _snapshot_digest(rows: Iterable[tuple[str, str, str]]) -> str:
    """Digest path + git mode + exact bytes/symlink target digest rows."""
    h = hashlib.sha256()
    for path, mode, content_digest in sorted(rows):
        h.update(path.encode("utf-8"))
        h.update(b"\0")
        h.update(mode.encode("ascii"))
        h.update(b"\0")
        h.update(content_digest.encode("ascii"))
        h.update(b"\n")
    return h.hexdigest()


def copy_component(name: str, repository: str, source_dir: Path, output_root: Path) -> ComponentSnapshot:
    source_dir = source_dir.expanduser().resolve()
    commit = _assert_source_checkout(source_dir)
    destination = output_root / COMPONENT_DIR / name
    destination.mkdir(parents=True, exist_ok=False)

    digest_rows: list[tuple[str, str, str]] = []
    entries = _tracked_entries(source_dir)
    for git_mode, rel_text in entries:
        rel = Path(rel_text)
        _refuse_sensitive_path(rel)
        src = source_dir / rel
        dst = destination / rel
        dst.parent.mkdir(parents=True, exist_ok=True)

        if git_mode == "120000":
            target = _safe_symlink_target(src, source_dir)
            os.symlink(target, dst)
            content_digest = hashlib.sha256(target.encode("utf-8")).hexdigest()
        else:
            if not src.is_file():
                raise DemoKitBuildError(f"tracked path is not a regular file: {src}")
            shutil.copy2(src, dst, follow_symlinks=False)
            content_digest = hashlib.sha256(src.read_bytes()).hexdigest()
            # Preserve executable intent from git even if the builder checkout's
            # filesystem mode was weakened.
            if git_mode == "100755":
                dst.chmod(dst.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        digest_rows.append((rel.as_posix(), git_mode, content_digest))

    return ComponentSnapshot(
        name=name,
        repository=repository,
        source_dir=source_dir,
        commit_sha=commit,
        tracked_file_count=len(entries),
        snapshot_sha256=_snapshot_digest(digest_rows),
    )


def _wrapper(command: str, title: str) -> str:
    del title
    return f'''#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${{COUNTERPEDIA_DEMO_KIT_PYTHON:-python3}}"
exec "$PYTHON" "$HERE/components/counterpedia-extension/tools/counterpedia-local/{command}" --bundle-root "$HERE"
'''


def _configure_key_wrapper() -> str:
    return '''#!/bin/bash
set -euo pipefail
SERVICE="counterpedia-openai-api-key"
if ! command -v security >/dev/null 2>&1; then
  echo "macOS Keychain 'security' command is unavailable." >&2
  exit 1
fi
printf "OpenAI API key for proposal drafting (input hidden): "
IFS= read -r -s KEY
echo
if [[ -z "$KEY" ]]; then
  echo "No key entered; nothing changed."
  exit 1
fi
security add-generic-password -U -a "$USER" -s "$SERVICE" -w "$KEY" >/dev/null
unset KEY
echo "Drafting key stored in macOS Keychain service: $SERVICE"
echo "The key is not written into the Counterpedia Demo Kit."
'''


def _readme() -> str:
    return """# Counterpedia Demo Kit

This bundle is a portable **team-beta / invited-evaluator** build of the
Counterpedia browser companion + local runtimes + Counterpedia Terminal.
It contains source snapshots pinned in `demo-kit-manifest.json`; it contains no
git metadata, model key, transport token, user capture store, or virtualenv.

## First use on macOS

1. Double-click **Install Counterpedia Demo.command**. This creates fresh local
   Python environments, installs Node dependencies, builds the extension, and
   installs the dedicated Chromium/Chrome-for-Testing runtime used by the demo.
2. Optional, for **Draft from source**: double-click
   **Configure Drafting Key.command** and enter the OpenAI API key supplied by
   the demo operator. The key is stored in macOS Keychain, not in this bundle.
3. Double-click **Start Counterpedia Demo.command**.
4. Double-click **Check Counterpedia Demo.command** if you want a bounded
   readiness report for Local, the canonical reader, and Terminal.

Normal use after installation is just Start; Check is diagnostic and starts
nothing.

## Canonical five-minute walkthrough

1. In the dedicated demo browser, open a public Wikipedia article.
2. Click the Counterpedia toolbar icon to open the side panel for that tab.
3. Click **Connect Counterpedia Local** once.
4. Inspect Counterpedia matches / source context. Browsing and matching are
   scanner observations, not CHECK conclusions.
5. Click **Capture this source**. A successful capture remains visibly
   **UNADMITTED**.
6. Optional: choose the retained capture as evidence and **Draft from source**.
   The result remains proposal-only; admission is not performed.
7. Optional: **Open in Counterpedia CHECK**. Prefill does not run CHECK; only an
   explicit **Run Check** performs the Counterpedia-owned epistemic operation.
8. Open the **Counterpedia Terminal** tab to inspect the local/private record
   layer surface. Terminal is a projection/read surface; it does not acquire
   authority merely by displaying records.

## Stop/reset

Double-click **Reset Counterpedia Demo.command**. It stops only processes whose
live command signatures still match the processes launched by this demo, and it
clears the dedicated ephemeral browser profile. Retained acquisition custody is
not deleted by the ordinary reset.

## Exact build identity

See `demo-kit-manifest.json` for component repositories, exact commit SHAs,
tracked-file counts, and per-component snapshot digests.

## Current beta boundary

This is a source-snapshot bundle with a one-time local installation step, not a
signed/notarized `.app` or `.pkg`. The bundle does not claim the latest
multi-repository browser proof is GREEN merely because packaging succeeded.
`AUTHORITY_MOVEMENT=0`.
"""


def _write_text(path: Path, content: str, executable: bool = False) -> None:
    path.write_text(content, encoding="utf-8")
    if executable:
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _bundle_digest(manifest_without_digest: dict[str, object]) -> str:
    body = json.dumps(manifest_without_digest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _zip_tree(root: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(root.rglob("*")):
            rel = Path(root.name) / path.relative_to(root)
            if path.is_symlink():
                # Preserve safe symlink identity rather than following it.
                info = zipfile.ZipInfo(rel.as_posix())
                info.create_system = 3
                info.external_attr = (0o120777 << 16)
                zf.writestr(info, os.readlink(path).encode("utf-8"))
            elif path.is_file():
                zf.write(path, rel.as_posix())


def build_demo_kit(
    *,
    extension_dir: Path,
    acquisition_dir: Path,
    authoring_dir: Path,
    counterpedia_dir: Path,
    terminal_dir: Path,
    output_dir: Path,
    make_zip: bool,
) -> dict[str, object]:
    output_dir = output_dir.expanduser().resolve()
    if output_dir.exists():
        raise DemoKitBuildError(f"output already exists; refusing to overwrite: {output_dir}")
    output_dir.mkdir(parents=True)
    try:
        sources = {
            "counterpedia-extension": extension_dir,
            "counterpedia-acquisition": acquisition_dir,
            "counterpedia-authoring": authoring_dir,
            "counterpedia": counterpedia_dir,
            "counterpedia-console": terminal_dir,
        }
        snapshots = [
            copy_component(name, repository, sources[name], output_dir)
            for name, repository in COMPONENTS
        ]

        _write_text(output_dir / "Install Counterpedia Demo.command", _wrapper("demo_kit_install.py", "Install"), True)
        _write_text(output_dir / "Start Counterpedia Demo.command", _wrapper("demo_kit_runtime.py", "Start"), True)
        _write_text(output_dir / "Check Counterpedia Demo.command", _wrapper("demo_kit_check.py", "Check"), True)
        _write_text(output_dir / "Reset Counterpedia Demo.command", _wrapper("demo_kit_reset.py", "Reset"), True)
        _write_text(output_dir / "Configure Drafting Key.command", _configure_key_wrapper(), True)
        _write_text(output_dir / "README.md", _readme())

        manifest: dict[str, object] = {
            "schema_version": MANIFEST_SCHEMA,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "authority_movement": 0,
            "admission_effect": "none",
            "standing_effect": "none",
            "packaging_posture": "tracked_source_snapshots_only",
            "components": [snapshot.to_dict() for snapshot in snapshots],
        }
        manifest["manifest_digest"] = f"sha256:{_bundle_digest(manifest)}"
        _write_text(output_dir / "demo-kit-manifest.json", json.dumps(manifest, indent=2) + "\n")

        if make_zip:
            _zip_tree(output_dir, output_dir.with_suffix(".zip"))
        return manifest
    except Exception:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise


def _default_extension_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extension-dir", type=Path, default=_default_extension_dir())
    parser.add_argument("--acquisition-dir", type=Path, required=True)
    parser.add_argument("--authoring-dir", type=Path, required=True)
    parser.add_argument("--counterpedia-dir", type=Path, required=True)
    parser.add_argument("--terminal-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--zip", action="store_true", dest="make_zip")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        manifest = build_demo_kit(
            extension_dir=args.extension_dir,
            acquisition_dir=args.acquisition_dir,
            authoring_dir=args.authoring_dir,
            counterpedia_dir=args.counterpedia_dir,
            terminal_dir=args.terminal_dir,
            output_dir=args.output_dir,
            make_zip=args.make_zip,
        )
    except DemoKitBuildError as exc:
        print(f"DEMO_KIT_BUILD_REFUSED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
