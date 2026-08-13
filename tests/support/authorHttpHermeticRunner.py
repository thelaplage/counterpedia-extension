"""
Hermetic AUTHOR-HTTP runner for the extension's two-server draft-from-source E2E.

This is TEST SCAFFOLDING for the counterpedia-extension repo. It reuses the REAL
authoring transport and the REAL deterministic fakes from a counterpedia-authoring
checkout, but lets the CALLER control the governed source URL so that the
authoring producer's plan candidate URL is exactly the URL the (separate) real
ACQ1 acquisition server captured. That URL continuity is what the transport's
`_assert_governed_url_continuity` requires, and it is the whole point of the
two-server proof: one governed source URL threads all three acts.

It does NOT re-implement the authoring pipeline. It imports the authoring repo's
own `_author_http_hermetic_server.py` (the FixedResponseAdapter plan +
FakeAcquisitionClient + FakeComposerAdapter builders) and simply overrides the
module-level SUBJECT_URL to the URL passed on the command line before building
the deps. The operator claim material is NOT here — it arrives in the POST body
the Node client sends, proving the transport never synthesizes claims.

Usage:  python authorHttpHermeticRunner.py <governed_source_url> <port>
Resolution: COUNTERPEDIA_AUTHORING_DIR must point at a counterpedia-authoring
checkout on the AUTHOR-HTTP branch. Prints one line `PORT <n>` once bound.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path


def _load_authoring_hermetic_module():
    authoring_dir = os.environ.get("COUNTERPEDIA_AUTHORING_DIR")
    if not authoring_dir:
        print("ERROR: COUNTERPEDIA_AUTHORING_DIR not set", file=sys.stderr, flush=True)
        raise SystemExit(2)
    root = Path(authoring_dir)
    src = root / "src"
    runner = root / "tests" / "integration" / "_author_http_hermetic_server.py"
    if not src.is_dir() or not runner.is_file():
        print(
            f"ERROR: authoring checkout incomplete under {authoring_dir}",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)
    # Make the authoring package importable, then load its hermetic builders.
    sys.path.insert(0, str(src))
    spec = importlib.util.spec_from_file_location(
        "_author_http_hermetic_server", str(runner)
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: authorHttpHermeticRunner.py <url> <port>", file=sys.stderr)
        raise SystemExit(2)
    governed_source_url = sys.argv[1]
    port = int(sys.argv[2])

    hs = _load_authoring_hermetic_module()

    # Control the governed source URL: the plan candidate + the FakeAcquisition
    # client registration both read this module global, so overriding it makes
    # the hermetic producer bind and "re-fetch" exactly the operator's URL.
    hs.SUBJECT_URL = governed_source_url

    deps = hs.AuthoringTransportDeps(
        planner_adapter=hs._build_planner_adapter(),
        composer_adapter=hs._build_composer_adapter(),
        acquisition_client=hs._build_acquisition_client(),
    )
    server = hs.build_http_server(deps, host="127.0.0.1", port=port)
    bound_port = server.server_address[1]
    print(f"PORT {bound_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
