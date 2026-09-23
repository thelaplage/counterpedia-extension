#!/usr/bin/env python3
"""Build a self-contained Counterpedia Local macOS .app.

This is a packaging layer over already-owned runtime entrypoints. It does not
reimplement acquisition or authoring. The resulting app embeds frozen executables
for the exact commands the existing Counterpedia Local supervisor expects.

A Developer ID identity is optional for local build verification. Distribution
must use one and then run ``notarize_app.sh``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

PYINSTALLER_VERSION = "6.22.3"
BUNDLE_ID = "org.counterpedia.local"
APP_NAME = "Counterpedia Local"
MANIFEST_SCHEMA = "counterpedia.local_macos_bundle.v0.1"


class BuildError(RuntimeError):
    pass


def run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> str:
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=900,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BuildError(f"could not run {' '.join(command)}") from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise BuildError(f"command failed ({completed.returncode}): {' '.join(command)}\n{detail}")
    return completed.stdout.strip()


def require_macos() -> None:
    if platform.system() != "Darwin":
        raise BuildError("Counterpedia Local .app builds must run on macOS")


def require_python_312(python_executable: Path) -> None:
    version = run([
        str(python_executable),
        "-c",
        "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
    ])
    try:
        major, minor = (int(part) for part in version.split(".", 1))
    except (ValueError, TypeError) as exc:
        raise BuildError(f"could not determine build Python version from {python_executable}") from exc
    if (major, minor) < (3, 12):
        raise BuildError(
            f"Counterpedia Local macOS build requires Python 3.12+; got {version}"
        )


def git_pin(repo: Path) -> str:
    repo = repo.expanduser().resolve()
    if not repo.is_dir():
        raise BuildError(f"checkout missing: {repo}")
    sha = run(["git", "-C", str(repo), "rev-parse", "HEAD"])
    if len(sha) != 40:
        raise BuildError(f"invalid git HEAD for {repo}")
    if subprocess.run(["git", "-C", str(repo), "diff", "--quiet"], check=False).returncode != 0:
        raise BuildError(f"tracked working-tree changes present: {repo}")
    if subprocess.run(["git", "-C", str(repo), "diff", "--cached", "--quiet"], check=False).returncode != 0:
        raise BuildError(f"staged changes present: {repo}")
    return sha


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _pyinstaller_base(
    python: Path,
    *,
    dist: Path,
    work: Path,
    specs: Path,
    codesign_identity: str | None,
) -> list[str]:
    command = [
        str(python),
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath",
        str(dist),
        "--workpath",
        str(work),
        "--specpath",
        str(specs),
    ]
    if codesign_identity:
        command += ["--codesign-identity", codesign_identity]
    return command


def build_onefile(
    python: Path,
    script: Path,
    name: str,
    *,
    dist: Path,
    work: Path,
    specs: Path,
    collect_all: Iterable[str],
    codesign_identity: str | None,
) -> Path:
    command = _pyinstaller_base(
        python, dist=dist, work=work / name, specs=specs, codesign_identity=codesign_identity
    )
    command += ["--onefile", "--console", "--name", name]
    for package in collect_all:
        command += ["--collect-all", package]
    command.append(str(script))
    run(command)
    output = dist / name
    if not output.is_file():
        raise BuildError(f"PyInstaller did not produce {output}")
    return output


def build_main_app(
    python: Path,
    launcher: Path,
    extension_dir: Path,
    *,
    dist: Path,
    work: Path,
    specs: Path,
    codesign_identity: str | None,
) -> Path:
    command = _pyinstaller_base(
        python,
        dist=dist,
        work=work / "counterpedia-local-app",
        specs=specs,
        codesign_identity=codesign_identity,
    )
    command += [
        "--windowed",
        "--name",
        APP_NAME,
        "--osx-bundle-identifier",
        BUNDLE_ID,
        "--paths",
        str(extension_dir / "tools" / "counterpedia-local"),
        "--hidden-import",
        "counterpedia_local",
        "--hidden-import",
        "counterpedia_local_operator",
        str(launcher),
    ]
    run(command)
    app = dist / f"{APP_NAME}.app"
    if not app.is_dir():
        raise BuildError(f"PyInstaller did not produce {app}")
    return app


def _copy_executable(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    destination.chmod(destination.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _resign_app(app: Path, identity: str | None) -> None:
    if identity:
        run([
            "codesign",
            "--force",
            "--deep",
            "--options",
            "runtime",
            "--timestamp",
            "--sign",
            identity,
            str(app),
        ])
    else:
        run(["codesign", "--force", "--deep", "--sign", "-", str(app)])
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=4", str(app)])


def build(
    *,
    extension_dir: Path,
    acquisition_dir: Path,
    authoring_dir: Path,
    dagr_sdk_dir: Path,
    dagr_mcp_dir: Path,
    output_dir: Path,
    python_executable: Path,
    codesign_identity: str | None,
) -> Path:
    require_macos()
    extension_dir = extension_dir.expanduser().resolve()
    acquisition_dir = acquisition_dir.expanduser().resolve()
    authoring_dir = authoring_dir.expanduser().resolve()
    dagr_sdk_dir = dagr_sdk_dir.expanduser().resolve()
    dagr_mcp_dir = dagr_mcp_dir.expanduser().resolve()
    output_dir = output_dir.expanduser().resolve()
    require_python_312(python_executable)
    if output_dir.exists() and any(output_dir.iterdir()):
        raise BuildError(f"output directory must be empty: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    pins = {
        "counterpedia-extension": git_pin(extension_dir),
        "counterpedia-acquisition": git_pin(acquisition_dir),
        "counterpedia-authoring": git_pin(authoring_dir),
        "dagr-sdk": git_pin(dagr_sdk_dir),
        "dagr-mcp": git_pin(dagr_mcp_dir),
    }
    source_dir = Path(__file__).resolve().parent

    with tempfile.TemporaryDirectory(prefix="counterpedia-macos-build-") as tmp_text:
        tmp = Path(tmp_text)
        venv = tmp / "venv"
        run([str(python_executable), "-m", "venv", str(venv)])
        build_python = venv / "bin" / "python"
        run([str(build_python), "-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "pip"])
        run([
            str(build_python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            f"pyinstaller=={PYINSTALLER_VERSION}",
            f"{acquisition_dir}[mcp]",
            f"{authoring_dir}[mcp]",
            str(dagr_sdk_dir),
            f"{dagr_mcp_dir}[official-sdk]",
        ])

        dist = tmp / "dist"
        work = tmp / "work"
        specs = tmp / "specs"
        dist.mkdir(); work.mkdir(); specs.mkdir()

        helpers = {
            "python": build_onefile(
                build_python,
                source_dir / "acquisition_python_shim.py",
                "python",
                dist=dist,
                work=work,
                specs=specs,
                collect_all=("acquisition", "acquisition_adapters", "mcp"),
                codesign_identity=codesign_identity,
            ),
            "counterpedia-acquisition-mcp": build_onefile(
                build_python,
                source_dir / "entry_acquisition_mcp.py",
                "counterpedia-acquisition-mcp",
                dist=dist,
                work=work,
                specs=specs,
                collect_all=(
                    "acquisition",
                    "acquisition_adapters",
                    "mcp",
                    "dagr_sdk",
                    "dagr_mcp",
                    "dagr_mcp_sdk_binding",
                    "dagr_mcp_local_demo",
                ),
                codesign_identity=codesign_identity,
            ),
            "counterpedia-wikipedia-harvest": build_onefile(
                build_python,
                source_dir / "entry_wikipedia_harvest.py",
                "counterpedia-wikipedia-harvest",
                dist=dist,
                work=work,
                specs=specs,
                collect_all=("acquisition", "acquisition_adapters"),
                codesign_identity=codesign_identity,
            ),
            "counterpedia-ingest-operator-snapshot": build_onefile(
                build_python,
                source_dir / "entry_operator_snapshot.py",
                "counterpedia-ingest-operator-snapshot",
                dist=dist,
                work=work,
                specs=specs,
                collect_all=("acquisition", "acquisition_adapters"),
                codesign_identity=codesign_identity,
            ),
            "counterpedia-authoring-live-source": build_onefile(
                build_python,
                source_dir / "entry_authoring_live_source.py",
                "counterpedia-authoring-live-source",
                dist=dist,
                work=work,
                specs=specs,
                collect_all=("counterpedia_authoring", "mcp"),
                codesign_identity=codesign_identity,
            ),
        }

        app = build_main_app(
            build_python,
            source_dir / "launcher.py",
            extension_dir,
            dist=dist,
            work=work,
            specs=specs,
            codesign_identity=codesign_identity,
        )
        resources = app / "Contents" / "Resources"
        acq_bin = resources / "runtime" / "counterpedia-acquisition" / ".venv" / "bin"
        auth_bin = resources / "runtime" / "counterpedia-authoring" / ".venv" / "bin"
        acq_scripts = resources / "runtime" / "counterpedia-acquisition" / "scripts"

        _copy_executable(helpers["python"], acq_bin / "python")
        for name in (
            "counterpedia-acquisition-mcp",
            "counterpedia-wikipedia-harvest",
            "counterpedia-ingest-operator-snapshot",
        ):
            _copy_executable(helpers[name], acq_bin / name)
        _copy_executable(helpers["counterpedia-authoring-live-source"], auth_bin / "counterpedia-authoring-live-source")
        acq_scripts.mkdir(parents=True, exist_ok=True)
        shutil.copy2(
            acquisition_dir / "scripts" / "run_counterpedia_local_transport.py",
            acq_scripts / "run_counterpedia_local_transport.py",
        )

        manifest = {
            "schema_version": MANIFEST_SCHEMA,
            "bundle_id": BUNDLE_ID,
            "authority_movement": 0,
            "admission_effect": "none",
            "standing_effect": "none",
            "pyinstaller_version": PYINSTALLER_VERSION,
            "components": pins,
            "runtime_helpers": {
                "counterpedia-acquisition/.venv/bin/python": sha256(acq_bin / "python"),
                "counterpedia-acquisition/.venv/bin/counterpedia-acquisition-mcp": sha256(acq_bin / "counterpedia-acquisition-mcp"),
                "counterpedia-acquisition/.venv/bin/counterpedia-wikipedia-harvest": sha256(acq_bin / "counterpedia-wikipedia-harvest"),
                "counterpedia-acquisition/.venv/bin/counterpedia-ingest-operator-snapshot": sha256(acq_bin / "counterpedia-ingest-operator-snapshot"),
                "counterpedia-authoring/.venv/bin/counterpedia-authoring-live-source": sha256(auth_bin / "counterpedia-authoring-live-source"),
            },
        }
        (resources / "counterpedia-local-bundle-manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

        _resign_app(app, codesign_identity)
        destination = output_dir / app.name
        shutil.copytree(app, destination, symlinks=True)
        return destination


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    default_extension = Path(__file__).resolve().parents[2]
    p.add_argument("--extension-dir", type=Path, default=default_extension)
    p.add_argument("--acquisition-dir", type=Path, required=True)
    p.add_argument("--authoring-dir", type=Path, required=True)
    p.add_argument("--dagr-sdk-dir", type=Path, required=True)
    p.add_argument("--dagr-mcp-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--python", type=Path, default=Path(sys.executable))
    p.add_argument("--codesign-identity", default=os.environ.get("COUNTERPEDIA_CODESIGN_IDENTITY"))
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        app = build(
            extension_dir=args.extension_dir,
            acquisition_dir=args.acquisition_dir,
            authoring_dir=args.authoring_dir,
            dagr_sdk_dir=args.dagr_sdk_dir,
            dagr_mcp_dir=args.dagr_mcp_dir,
            output_dir=args.output_dir,
            python_executable=args.python,
            codesign_identity=args.codesign_identity,
        )
    except BuildError as exc:
        print(f"COUNTERPEDIA_MACOS_BUILD_REFUSED: {exc}", file=sys.stderr)
        return 1
    print(app)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
