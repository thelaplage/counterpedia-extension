"""
Hermetic AUTHOR-HTTP launcher for the extension's draft-from-source
(held-capture) cross-process E2E.

This is DISTINCT test scaffolding from ``authorHttpHermeticRunner.py``
(which wires the fresh-fetch ``/v0/draft-from-url`` lane via
``tests/integration/_author_http_hermetic_server.py``'s
``acquisition_client`` fake). That fixture is structurally unusable for
``/v0/draft-from-source``: it never sets ``source_deps`` on
``build_http_server()``, so the historical-source route always 404s on a
server it builds, regardless of which branch the authoring checkout is on.

This launcher instead wires ``source_deps`` with a REAL
``held_capture_client`` (``ProducerAcquisitionToolClient`` over
``McpStdioAcquisitionToolTransport``) that spawns a REAL acquisition MCP
stdio subprocess (``acquisitionMcpStdioEntry.py``, sibling to this file) for
every held-capture resolution. No acquisition behavior is faked; the only
determinism knob is that subprocess's model observer (see that file's
docstring). ``composer_adapter`` and ``governance_provider`` remain
deterministic fakes -- exactly as legitimate here as in every other
AUTHOR-HTTP hermetic harness in this codebase, since they exercise the
composer/governance seam, not the acquisition seam under test.

Because ``/v0/draft-from-source`` builds its OWN
``RequestBoundSourcePlannerAdapter`` internally from the request's own
``candidates``/``capture_ref`` (see counterpedia-authoring's
``http_transport.py``, ``DraftFromSourceService.handle``), this launcher
does NOT need to know the governed source URL or candidate id in advance --
unlike the URL lane's fixture, there is no ``SUBJECT_URL`` to pre-bind. The
``deps.planner_adapter`` field below only backs the (here, unexercised)
``/v0/draft-from-url`` route and is never read by the source lane.

Usage:  python authorHttpSourceHermeticRunner.py <acquisition_src_dir> <store_root> <port>
Resolution: COUNTERPEDIA_AUTHORING_DIR must point at a counterpedia-authoring
checkout containing AUTH0-B1 (``DraftFromSourceService`` /
``held_capture_client`` / ``source_deps``). Prints one line `PORT <n>` once
bound.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _load_authoring_src() -> None:
    authoring_dir = os.environ.get("COUNTERPEDIA_AUTHORING_DIR")
    if not authoring_dir:
        print("ERROR: COUNTERPEDIA_AUTHORING_DIR not set", file=sys.stderr, flush=True)
        raise SystemExit(2)
    src = Path(authoring_dir) / "src"
    http_transport = src / "counterpedia_authoring" / "http_transport.py"
    if not src.is_dir() or not http_transport.is_file():
        print(
            f"ERROR: authoring checkout incomplete under {authoring_dir}",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)
    sys.path.insert(0, str(src))


def main() -> None:
    if len(sys.argv) < 4:
        print(
            "usage: authorHttpSourceHermeticRunner.py "
            "<acquisition_src_dir> <store_root> <port>",
            file=sys.stderr,
        )
        raise SystemExit(2)
    acquisition_src_dir = sys.argv[1]
    store_root = sys.argv[2]
    port = int(sys.argv[3])

    _load_authoring_src()

    from counterpedia_authoring.acquisition.tool_client import (
        McpStdioAcquisitionToolTransport,
        ProducerAcquisitionToolClient,
    )
    from counterpedia_authoring.adapters.fake_adapter import FixedResponseAdapter
    from counterpedia_authoring.composer import FakeComposerAdapter
    from counterpedia_authoring.contracts.claim_map import (
        CoverageRequirement,
        CoverageState,
    )
    from counterpedia_authoring.contracts.job import (
        AuthoringBudget,
        AuthoringJob,
        AuthoringJobMode,
    )
    from counterpedia_authoring.contracts.research_plan import ResearchDepth
    from counterpedia_authoring.contracts.strategy import (
        CoverageGate,
        ResearchStrategy,
        StrategyIterationBudget,
    )
    from counterpedia_authoring.http_transport import (
        AuthoringTransportDeps,
        build_http_server,
    )

    entry_script = str(_HERE / "acquisitionMcpStdioEntry.py")
    transport = McpStdioAcquisitionToolTransport(
        command=sys.executable,
        server_args=(entry_script, acquisition_src_dir, store_root),
    )
    held_client = ProducerAcquisitionToolClient(transport=transport)

    # Fixed (job, strategy) pair, built once at process startup -- mirrors
    # AUTHOR-BATCH-GOV-RECON0's governance_provider seam used throughout this
    # codebase's own hermetic test/fixture harnesses.
    _job = AuthoringJob.create(
        operator_objective="Hermetic draft-from-source HTTP e2e governance.",
        mode=AuthoringJobMode.draft,
        budget=AuthoringBudget(
            max_model_calls=6,
            max_acquisition_attempts=2,
            max_evidence_items=50,
            max_output_tokens=8192,
        ),
    )
    _strategy = ResearchStrategy.create(
        job=_job,
        permitted_depths=list(ResearchDepth),
        coverage_gate=CoverageGate(
            coverage_requirements=[
                CoverageRequirement(
                    requirement_id="req-core",
                    label="Core coverage",
                    description="Bounded descriptive coverage of the subject.",
                )
            ],
            acceptable_states=[
                CoverageState.sufficient_candidate_support,
                CoverageState.partial_support,
            ],
            unresolved_conflicts_block_progression=True,
        ),
        iteration_budget=StrategyIterationBudget(
            max_research_iterations=1,
            max_acquisition_iterations=2,
            max_claim_revision_iterations=1,
            max_total_model_calls=4,
        ),
    )

    def _governance_provider(subject_seed: str, operator_objective: str):
        return _job, _strategy

    # The held-capture evidence bundle always allocates E001 to the capture
    # item itself whenever a capture_receipt is resolved (see
    # counterpedia-authoring's evidence_builder/builder.py,
    # add_acquisition_session()); a second, abstractive-synthesis handle
    # (E002) is allocated ONLY if the observer's grounding produced a
    # non-empty proposal for the captured bytes. The E2E's fixture bytes are
    # deliberately field-free HTML (no <title>/<h1>/meta description), so
    # DeterministicHtmlBackend proposes zero fields and no E002 is minted.
    # Reference ONLY evidence:E001 here so this composer/claims wiring never
    # depends on that grounding detail.
    composer_payload = {
        "title_suggestion": "Draft-from-source E2E fixture",
        "lead_blocks": [
            {
                "kind": "paragraph",
                "text": "Deterministic held-capture composition over the retained bytes.",
                "evidence_refs": ["evidence:E001"],
                "notes": None,
            }
        ],
        "section_blocks": [],
        "proposition_records": [],
        "link_suggestions": [],
        "unsupported_slots": [],
        "open_questions": [],
        "cp_page_id_suggestion": None,
        "notes": None,
    }

    # Unused by /v0/draft-from-source (that route builds its own
    # RequestBoundSourcePlannerAdapter per-request); present only because
    # AuthoringTransportDeps also backs the (here, unexercised)
    # /v0/draft-from-url route, which requires a planner_adapter value.
    unused_url_lane_planner = FixedResponseAdapter(
        json.dumps({"error": "draft-from-url is not exercised by this launcher"})
    )

    deps = AuthoringTransportDeps(
        planner_adapter=unused_url_lane_planner,
        composer_adapter=FakeComposerAdapter(composer_payload),
        governance_provider=_governance_provider,
        held_capture_client=held_client,
    )
    server = build_http_server(deps, host="127.0.0.1", port=port, source_deps=deps)
    bound_port = server.server_address[1]
    print(f"PORT {bound_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
