#!/usr/bin/env python3
"""Frozen checkout-contract adapter for Counterpedia Local.

Counterpedia Local's reviewed checkout-mode contract launches:

  <acquisition>/.venv/bin/python <acquisition>/scripts/run_counterpedia_local_transport.py

A distributed .app has no checkout virtualenv. The frozen adapter is a flat
Mach-O helper under Contents/Helpers, while the logical acquisition checkout
root lives under Contents/Resources. This adapter validates the exact one
allowed provenance-script argument and then delegates to the producer-owned
packaged transport entrypoint. It is deliberately NOT a general Python
interpreter.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _contents_root(executable: Path) -> Path:
    exe = executable.absolute()
    # .../Counterpedia Local.app/Contents/Helpers/counterpedia-acquisition-python
    helpers = exe.parent
    contents = helpers.parent
    if (
        exe.name != "counterpedia-acquisition-python"
        or helpers.name != "Helpers"
        or contents.name != "Contents"
    ):
        raise ValueError("Counterpedia Local acquisition adapter is outside the expected app layout")
    return contents


def _expected_script(executable: Path) -> Path:
    contents = _contents_root(executable)
    return (
        contents
        / "Resources"
        / "runtime"
        / "counterpedia-acquisition"
        / "scripts"
        / "run_counterpedia_local_transport.py"
    )


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        expected = _expected_script(Path(sys.executable))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 66
    if len(args) != 1 or Path(args[0]).absolute() != expected.absolute():
        print(
            "Counterpedia Local bundled acquisition adapter refuses general Python execution",
            file=sys.stderr,
        )
        return 64
    if not expected.is_file():
        print("Counterpedia Local bundled acquisition launcher provenance file is missing", file=sys.stderr)
        return 66
    from acquisition.local_transport_launcher import main as transport_main

    return transport_main()


if __name__ == "__main__":
    raise SystemExit(main())
