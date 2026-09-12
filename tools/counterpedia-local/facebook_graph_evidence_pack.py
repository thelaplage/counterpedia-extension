#!/usr/bin/env python3
"""Build a local, authority-neutral evidence pack from FACEBOOK-GRAPH0 operator runs.

This is orchestration only. It does not access Facebook, drive Chrome, replay
GraphQL, fetch candidate references, mint Registry identities, or execute
Workbench actions. It consumes already-normalized operator observations and
invokes the exact pinned producer/consumer lanes that own each transformation.

The pack contains:
- one run-specific FACEBOOK-GRAPH0 census for every non-empty operator run;
- one overall census across all observations;
- one FACEBOOK-STABILITY0 descriptive drift report over run-specific censuses;
- one FACEBOOK-REFERENCE-DESCENT0 candidate-locator set per observation;
- one FACEBOOK-REG0-CROSSWALK0 proposal per observation;
- a Workbench-consumer input inventory pinned to WB-FACEBOOK-OBS-FEED0;
- a deterministic manifest over all generated JSON artifacts.

Raw CDP response bodies remain in the existing Acquisition object store and are
not copied into the evidence pack.

AUTHORITY_MOVEMENT = 0.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

FACEBOOK_G0_SHA = "c5e5d18bfac3ec0b12f36e7a52c1298a3845cdbb"
FACEBOOK_STABILITY_SHA = "226c319a217ad050e541f1feb7e430c6a8795426"
FACEBOOK_REFERENCE_DESCENT_SHA = "b46b427b0560f6bdc2016922d54befe13d0b014c"
FACEBOOK_REG0_CROSSWALK_SHA = "6725013c4f27ae6f6d1d266a712d45b8caea7d7d"
WB_FACEBOOK_OBS_FEED_SHA = "4d6e0608424e4343311ce96a9d3d1f47ce9271c6"
FACEBOOK_OPERATOR_PARENT_SHA = "e812813a8e88b1a7d8cfe143640a223205e5768a"

PACK_SCHEMA = "counterpedia.extension.facebook_graph_evidence_pack.v0.1"
WORKBENCH_INPUT_SCHEMA = "counterpedia.extension.facebook_workbench_inputs.v0.1"
OPERATOR_RUN_KEYS = frozenset(
    {
        "artifact_type",
        "spec_version",
        "authority_movement",
        "shipping_extension_runtime_modified",
        "target_id",
        "target_url",
        "surface_class",
        "access_class",
        "duration_seconds",
        "acquisition_sha",
        "normalized_observation_files",
        "new_observation_count",
        "census_file",
    }
)


class EvidencePackError(RuntimeError):
    pass


@dataclass(frozen=True)
class OperatorRun:
    run_file: Path
    surface_class: str
    access_class: str
    observation_files: tuple[Path, ...]


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _digest_json(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def _digest_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EvidencePackError(f"cannot read JSON object {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EvidencePackError(f"{path}: expected one JSON object")
    return value


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _git_head(repo: Path) -> str | None:
    proc = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    return proc.stdout.strip() if proc.returncode == 0 else None


def _worktrees(repo: Path) -> list[tuple[Path, str]]:
    proc = subprocess.run(
        ["git", "-C", str(repo), "worktree", "list", "--porcelain"],
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return []
    rows: list[tuple[Path, str]] = []
    current: Path | None = None
    for line in proc.stdout.splitlines():
        if line.startswith("worktree "):
            current = Path(line[len("worktree ") :])
        elif line.startswith("HEAD ") and current is not None:
            rows.append((current, line[len("HEAD ") :].strip()))
    return rows


def _resolve_exact_checkout(
    *,
    repo_name: str,
    expected_sha: str,
    extension_root: Path,
    explicit: Path | None,
) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit.expanduser().resolve())
    sibling = extension_root.parent / repo_name
    if sibling not in candidates:
        candidates.append(sibling)

    inspected: list[str] = []
    for candidate in candidates:
        if not candidate.exists():
            inspected.append(f"{candidate}=missing")
            continue
        head = _git_head(candidate)
        inspected.append(f"{candidate}={head or 'not-a-git-checkout'}")
        if head == expected_sha:
            return candidate
        if head is not None:
            for worktree, worktree_head in _worktrees(candidate):
                if worktree_head == expected_sha and worktree.exists():
                    return worktree.resolve()

    raise EvidencePackError(
        f"cannot find {repo_name} checkout/worktree at exact pin {expected_sha}; "
        f"inspected: {', '.join(inspected)}. Create/fetch a worktree at that exact "
        "commit rather than running against drifting producer semantics."
    )


def _run(
    cmd: list[str],
    *,
    cwd: Path,
    pythonpath: Path | None = None,
) -> None:
    env = os.environ.copy()
    if pythonpath is not None:
        env["PYTHONPATH"] = str(pythonpath)
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
        raise EvidencePackError(f"subprocess failed: {' '.join(cmd)}\n{detail}")


def _validate_observation_file(path: Path) -> None:
    body = _load_json(path)
    if body.get("schema_version") != "acquisition.facebook_graph_observation.v0.1":
        raise EvidencePackError(f"{path}: not a FACEBOOK-GRAPH0 observation")
    if body.get("authority_movement") != 0:
        raise EvidencePackError(f"{path}: authority_movement must equal 0")
    response_digest = body.get("response_bytes_sha256")
    if not isinstance(response_digest, str) or not response_digest.startswith("sha256:"):
        raise EvidencePackError(f"{path}: missing response_bytes_sha256")
    if body.get("response_object_address") != response_digest:
        raise EvidencePackError(f"{path}: response object address/digest mismatch")


def _load_operator_runs(operator_output: Path) -> tuple[OperatorRun, ...]:
    observations_root = operator_output / "observations"
    run_paths = sorted(operator_output.glob("operator-run-*.json"))
    if not run_paths:
        raise EvidencePackError(f"no operator-run-*.json records found under {operator_output}")

    seen_observations: set[str] = set()
    runs: list[OperatorRun] = []
    for run_path in run_paths:
        body = _load_json(run_path)
        unknown = sorted(set(body) - OPERATOR_RUN_KEYS)
        if unknown:
            raise EvidencePackError(
                f"{run_path}: unknown operator-run fields: {', '.join(unknown)}"
            )
        if body.get("artifact_type") != "FacebookGraphOperatorRun" or body.get("spec_version") != "v0.1":
            raise EvidencePackError(f"{run_path}: unsupported operator-run schema")
        if body.get("authority_movement") != 0 or body.get("shipping_extension_runtime_modified") is not False:
            raise EvidencePackError(f"{run_path}: operator authority/runtime boundary mismatch")
        if body.get("acquisition_sha") != FACEBOOK_G0_SHA:
            raise EvidencePackError(
                f"{run_path}: acquisition pin mismatch; expected {FACEBOOK_G0_SHA}"
            )
        surface = body.get("surface_class")
        access = body.get("access_class")
        if not isinstance(surface, str) or not surface:
            raise EvidencePackError(f"{run_path}: surface_class must be non-empty")
        if not isinstance(access, str) or not access:
            raise EvidencePackError(f"{run_path}: access_class must be non-empty")
        names = body.get("normalized_observation_files")
        if not isinstance(names, list) or any(not isinstance(name, str) or not name for name in names):
            raise EvidencePackError(f"{run_path}: normalized_observation_files must be strings")
        if body.get("new_observation_count") != len(names):
            raise EvidencePackError(f"{run_path}: new_observation_count does not match file list")

        files: list[Path] = []
        for name in names:
            if Path(name).name != name:
                raise EvidencePackError(f"{run_path}: observation filename must be a basename")
            if name in seen_observations:
                raise EvidencePackError(f"{run_path}: duplicate observation ownership for {name}")
            seen_observations.add(name)
            observation_path = observations_root / name
            if not observation_path.is_file():
                raise EvidencePackError(f"{run_path}: missing normalized observation {name}")
            _validate_observation_file(observation_path)
            files.append(observation_path)
        runs.append(
            OperatorRun(
                run_file=run_path,
                surface_class=surface,
                access_class=access,
                observation_files=tuple(files),
            )
        )
    return tuple(runs)


def _build_census(
    *,
    observations: Iterable[Path],
    out: Path,
    object_store: Path,
    g0_root: Path,
) -> None:
    paths = list(observations)
    if not paths:
        raise EvidencePackError("cannot build a census from an empty observation set")
    cmd = [sys.executable, str(g0_root / "scripts" / "facebook_graph0.py"), "census"]
    for path in paths:
        cmd.extend(["--observation", str(path)])
    cmd.extend(["--object-store", str(object_store), "--out", str(out)])
    _run(cmd, cwd=g0_root, pythonpath=g0_root / "src")


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _artifact_descriptor(path: Path, pack_root: Path) -> dict[str, Any]:
    body = _load_json(path)
    schema = body.get("schema_version")
    if not isinstance(schema, str) or not schema:
        raise EvidencePackError(f"{path}: generated artifact lacks schema_version")
    digest = None
    for field in ("census_digest", "report_digest", "reference_set_digest", "crosswalk_digest"):
        value = body.get(field)
        if isinstance(value, str) and value.startswith("sha256:"):
            digest = value
            break
    if digest is None:
        raise EvidencePackError(f"{path}: generated artifact lacks producer digest")
    return {
        "path": _relative(path, pack_root),
        "schema_version": schema,
        "producer_digest": digest,
        "file_sha256": _digest_file(path),
    }


def build_evidence_pack(args: argparse.Namespace) -> Path:
    script_path = Path(__file__).resolve()
    extension_root = script_path.parents[2]
    if _git_head(extension_root) is None:
        raise EvidencePackError("cannot resolve counterpedia-extension git checkout")

    operator_output = args.operator_output.expanduser().resolve()
    object_store = args.object_store.expanduser().resolve()
    if not operator_output.is_dir():
        raise EvidencePackError(f"operator output directory not found: {operator_output}")
    if not object_store.is_dir():
        raise EvidencePackError(f"FACEBOOK-GRAPH0 object store not found: {object_store}")

    g0_root = _resolve_exact_checkout(
        repo_name="counterpedia-acquisition",
        expected_sha=FACEBOOK_G0_SHA,
        extension_root=extension_root,
        explicit=args.acquisition_g0_root,
    )
    stability_root = _resolve_exact_checkout(
        repo_name="counterpedia-acquisition",
        expected_sha=FACEBOOK_STABILITY_SHA,
        extension_root=extension_root,
        explicit=args.stability_root,
    )
    descent_root = _resolve_exact_checkout(
        repo_name="counterpedia-acquisition",
        expected_sha=FACEBOOK_REFERENCE_DESCENT_SHA,
        extension_root=extension_root,
        explicit=args.descent_root,
    )
    registry_root = _resolve_exact_checkout(
        repo_name="counterpedia-registry",
        expected_sha=FACEBOOK_REG0_CROSSWALK_SHA,
        extension_root=extension_root,
        explicit=args.registry_root,
    )

    runs = _load_operator_runs(operator_output)
    all_observations = [path for run in runs for path in run.observation_files]
    if not all_observations:
        raise EvidencePackError("operator ledger contains zero normalized observations")

    if args.out is None:
        pack_root = operator_output / "evidence-packs" / f"pack-{time.time_ns()}"
    else:
        pack_root = args.out.expanduser().resolve()
    if pack_root.exists() and any(pack_root.iterdir()):
        raise EvidencePackError(f"refusing non-empty evidence-pack destination: {pack_root}")
    pack_root.mkdir(parents=True, exist_ok=True)
    os.chmod(pack_root, 0o700)

    nonempty_runs: list[tuple[int, OperatorRun, Path]] = []
    zero_runs: list[dict[str, Any]] = []
    for index, run in enumerate(runs):
        if not run.observation_files:
            zero_runs.append(
                {
                    "sequence_index": index,
                    "run_file": run.run_file.name,
                    "surface_class": run.surface_class,
                    "access_class": run.access_class,
                    "reason": "operator run produced zero normalized GraphQL observations",
                }
            )
            continue
        census_path = pack_root / "censuses" / f"run-{index:03d}.json"
        _build_census(
            observations=run.observation_files,
            out=census_path,
            object_store=object_store,
            g0_root=g0_root,
        )
        nonempty_runs.append((index, run, census_path))

    overall_census = pack_root / "census-overall.json"
    _build_census(
        observations=all_observations,
        out=overall_census,
        object_store=object_store,
        g0_root=g0_root,
    )

    run_spec = {
        "runs": [
            {
                "sequence_index": sequence_index,
                "run_label": f"{sequence_index:03d}:{run.surface_class}:{run.run_file.stem[-18:]}",
                "census_path": _relative(census_path, pack_root),
            }
            for sequence_index, run, census_path in nonempty_runs
        ]
    }
    run_spec_path = pack_root / ".stability-run-spec.json"
    _write_json(run_spec_path, run_spec)
    stability_path = pack_root / "stability.json"
    _run(
        [
            sys.executable,
            str(stability_root / "scripts" / "facebook_graph_stability0.py"),
            "--run-spec",
            str(run_spec_path.name),
            "--out",
            str(stability_path.name),
        ],
        cwd=pack_root,
        pythonpath=stability_root / "src",
    )
    run_spec_path.unlink(missing_ok=True)

    reference_paths: list[Path] = []
    crosswalk_paths: list[Path] = []
    for observation in all_observations:
        reference_out = pack_root / "references" / observation.name
        _run(
            [
                sys.executable,
                str(descent_root / "scripts" / "facebook_reference_descent0.py"),
                "--observation",
                str(observation),
                "--object-store",
                str(object_store),
                "--out",
                str(reference_out),
            ],
            cwd=descent_root,
            pythonpath=descent_root / "src",
        )
        reference_paths.append(reference_out)

        crosswalk_out = pack_root / "reg0-crosswalk" / observation.name
        _run(
            [
                sys.executable,
                str(registry_root / "integrations" / "scripts" / "facebook_graph_reg0_crosswalk.py"),
                "--observation",
                str(observation),
                "--out",
                str(crosswalk_out),
            ],
            cwd=registry_root,
        )
        crosswalk_paths.append(crosswalk_out)

    review_artifacts = [
        _artifact_descriptor(overall_census, pack_root),
        _artifact_descriptor(stability_path, pack_root),
        *[_artifact_descriptor(path, pack_root) for path in reference_paths],
        *[_artifact_descriptor(path, pack_root) for path in crosswalk_paths],
    ]
    workbench_inputs = {
        "schema_version": WORKBENCH_INPUT_SCHEMA,
        "consumer": "counterpedia-workbench/WB-FACEBOOK-OBS-FEED0",
        "consumer_sha": WB_FACEBOOK_OBS_FEED_SHA,
        "artifacts": review_artifacts,
        "note": (
            "Each listed artifact is an input to facebookArtifactToReviewFeed; this pack "
            "does not execute Workbench or invent availableActions."
        ),
        "authority_movement": 0,
    }
    workbench_inputs["input_set_digest"] = _digest_json(workbench_inputs)
    workbench_path = pack_root / "workbench-inputs.json"
    _write_json(workbench_path, workbench_inputs)

    generated_json = [
        *[row[2] for row in nonempty_runs],
        overall_census,
        stability_path,
        *reference_paths,
        *crosswalk_paths,
        workbench_path,
    ]
    manifest_files = [
        {
            "path": _relative(path, pack_root),
            "sha256": _digest_file(path),
        }
        for path in sorted(generated_json, key=lambda p: _relative(p, pack_root))
    ]
    manifest: dict[str, Any] = {
        "artifact_type": "FacebookGraphEvidencePack",
        "schema_version": PACK_SCHEMA,
        "pins": {
            "operator_parent": FACEBOOK_OPERATOR_PARENT_SHA,
            "facebook_graph0": FACEBOOK_G0_SHA,
            "facebook_stability0": FACEBOOK_STABILITY_SHA,
            "facebook_reference_descent0": FACEBOOK_REFERENCE_DESCENT_SHA,
            "facebook_reg0_crosswalk0": FACEBOOK_REG0_CROSSWALK_SHA,
            "workbench_facebook_obs_feed0": WB_FACEBOOK_OBS_FEED_SHA,
        },
        "operator_run_count": len(runs),
        "nonempty_run_count": len(nonempty_runs),
        "zero_observation_runs": zero_runs,
        "normalized_observation_count": len(all_observations),
        "run_census_count": len(nonempty_runs),
        "reference_set_count": len(reference_paths),
        "reg0_crosswalk_count": len(crosswalk_paths),
        "raw_response_bodies_copied_into_pack": False,
        "workbench_consumer_executed": False,
        "files": manifest_files,
        "non_claims": [
            "evidence_pack != admission",
            "candidate_locator != capture",
            "longitudinal_report != stability_verdict",
            "registry_crosswalk_proposal != source_record_identity",
            "workbench_input_inventory != review_action",
            "facebook_observation != public_reproducibility",
        ],
        "authority_movement": 0,
    }
    manifest["pack_digest"] = _digest_json(manifest)
    manifest_path = pack_root / "manifest.json"
    _write_json(manifest_path, manifest)

    return manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--operator-output",
        type=Path,
        default=Path.home() / ".counterpedia" / "facebook-graph0" / "operator",
    )
    parser.add_argument(
        "--object-store",
        type=Path,
        default=Path.home() / ".counterpedia" / "facebook-graph0" / "objects",
    )
    parser.add_argument("--out", type=Path)
    parser.add_argument("--acquisition-g0-root", type=Path)
    parser.add_argument("--stability-root", type=Path)
    parser.add_argument("--descent-root", type=Path)
    parser.add_argument("--registry-root", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        manifest_path = build_evidence_pack(args)
    except EvidencePackError as exc:
        print(f"FACEBOOK-EVIDENCE-PACK0 ERROR: {exc}", file=sys.stderr)
        return 2
    print(str(manifest_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
