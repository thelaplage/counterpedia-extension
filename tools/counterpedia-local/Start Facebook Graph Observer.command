#!/bin/bash
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "FACEBOOK-GRAPH0: could not resolve counterpedia-extension repo root." >&2
  exit 1
fi

PYTHON="${COUNTERPEDIA_FACEBOOK_PYTHON:-python3}"
CDP_PORT="${COUNTERPEDIA_FACEBOOK_CDP_PORT:-9222}"
PROFILE="${COUNTERPEDIA_FACEBOOK_PROFILE:-$HOME/.counterpedia-facebook-observer}"
OUTPUT_DIR="${COUNTERPEDIA_FACEBOOK_OUTPUT_DIR:-$HOME/.counterpedia/facebook-graph0/operator}"
OBJECT_STORE="${COUNTERPEDIA_FACEBOOK_OBJECT_STORE:-$HOME/.counterpedia/facebook-graph0/objects}"
ACQ_SHA="c5e5d18bfac3ec0b12f36e7a52c1298a3845cdbb"
DEFAULT_ACQ="$(cd "$REPO_ROOT/.." && pwd)/counterpedia-acquisition"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "FACEBOOK-GRAPH0: Python 3 is required." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "FACEBOOK-GRAPH0: git is required." >&2
  exit 1
fi
if ! command -v open >/dev/null 2>&1; then
  echo "FACEBOOK-GRAPH0: this launcher is for macOS (missing 'open')." >&2
  exit 1
fi

resolve_acquisition_root() {
  if [[ -n "${COUNTERPEDIA_ACQUISITION_ROOT:-}" ]]; then
    printf '%s\n' "$COUNTERPEDIA_ACQUISITION_ROOT"
    return
  fi

  if [[ -e "$DEFAULT_ACQ/.git" ]]; then
    local head
    head="$(git -C "$DEFAULT_ACQ" rev-parse HEAD 2>/dev/null || true)"
    if [[ "$head" == "$ACQ_SHA" ]]; then
      printf '%s\n' "$DEFAULT_ACQ"
      return
    fi

    local pinned_worktree
    pinned_worktree="$(git -C "$DEFAULT_ACQ" worktree list --porcelain 2>/dev/null | awk -v sha="$ACQ_SHA" '
      $1 == "worktree" { path = substr($0, 10) }
      $1 == "HEAD" && $2 == sha { print path; exit }
    ')"
    if [[ -n "$pinned_worktree" ]]; then
      printf '%s\n' "$pinned_worktree"
      return
    fi
  fi

  printf '%s\n' "$DEFAULT_ACQ"
}

ACQ_ROOT="$(resolve_acquisition_root)"
if [[ ! -e "$ACQ_ROOT/.git" ]]; then
  echo "FACEBOOK-GRAPH0: acquisition checkout not found at: $ACQ_ROOT" >&2
  echo "Set COUNTERPEDIA_ACQUISITION_ROOT to a checkout/worktree at #226 head $ACQ_SHA." >&2
  exit 1
fi
ACTUAL_ACQ_SHA="$(git -C "$ACQ_ROOT" rev-parse HEAD 2>/dev/null || true)"
if [[ "$ACTUAL_ACQ_SHA" != "$ACQ_SHA" ]]; then
  echo "FACEBOOK-GRAPH0: acquisition checkout is not pinned to PR #226." >&2
  echo "Expected: $ACQ_SHA" >&2
  echo "Actual:   ${ACTUAL_ACQ_SHA:-unresolved}" >&2
  echo "Point COUNTERPEDIA_ACQUISITION_ROOT at a worktree with the exact expected head." >&2
  exit 1
fi

OPERATOR="$HERE/facebook_graph_operator.py"
if [[ ! -f "$OPERATOR" ]]; then
  echo "FACEBOOK-GRAPH0: missing operator harness: $OPERATOR" >&2
  exit 1
fi

mkdir -p "$PROFILE" "$OUTPUT_DIR" "$OBJECT_STORE"
chmod 700 "$PROFILE" "$OUTPUT_DIR" "$OBJECT_STORE" 2>/dev/null || true
PRODUCER_REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"

cat <<INTRO

FACEBOOK-GRAPH0 OPERATOR
------------------------
This is an operator-only observation session.

- Chrome uses a dedicated debugging profile: $PROFILE
- The harness does NOT log in, read cookies, replay GraphQL, scrape DOM/text,
  take screenshots, or navigate Facebook for you.
- You sign in manually (if needed) and choose ordinary Facebook surfaces.
- Durable output: $OUTPUT_DIR
- Content-addressed observed bodies: $OBJECT_STORE
- Acquisition pin: $ACQ_SHA

INTRO

if ! curl -fsS "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  echo "Launching dedicated Chrome debug profile on port $CDP_PORT ..."
  open -na "Google Chrome" --args \
    --remote-debugging-port="$CDP_PORT" \
    --user-data-dir="$PROFILE" \
    about:blank

  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

if ! curl -fsS "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  echo "FACEBOOK-GRAPH0: Chrome CDP did not become available on port $CDP_PORT." >&2
  exit 1
fi

echo
read -r -p "In the dedicated Chrome window, sign in manually if needed and open the Facebook surface you want to observe. Press Return when ready: " _

while true; do
  echo
  echo "Eligible Facebook tabs:"
  "$PYTHON" "$OPERATOR" list-targets --cdp-port "$CDP_PORT"
  echo
  read -r -p "Paste the target id to observe (or q to finish): " TARGET_ID
  if [[ "$TARGET_ID" == "q" || "$TARGET_ID" == "Q" ]]; then
    break
  fi
  if [[ -z "$TARGET_ID" ]]; then
    echo "Target id is required."
    continue
  fi

  echo "Surface examples: page, page_post, event, marketplace_listing, public_group_post"
  read -r -p "Surface class: " SURFACE_CLASS
  if [[ -z "$SURFACE_CLASS" ]]; then
    echo "Surface class is required."
    continue
  fi

  read -r -p "Access class [session_observed]: " ACCESS_CLASS
  ACCESS_CLASS="${ACCESS_CLASS:-session_observed}"
  case "$ACCESS_CLASS" in
    public_reproducible|authenticated_reproducible|session_observed|operator_only|no_longer_available) ;;
    *)
      echo "Unsupported access class: $ACCESS_CLASS"
      continue
      ;;
  esac

  read -r -p "Capture duration seconds [30]: " DURATION
  DURATION="${DURATION:-30}"

  echo
  echo "Capture armed for $DURATION seconds. Use the selected Facebook surface normally in Chrome."
  "$PYTHON" "$OPERATOR" capture \
    --cdp-port "$CDP_PORT" \
    --target-id "$TARGET_ID" \
    --duration "$DURATION" \
    --surface-class "$SURFACE_CLASS" \
    --access-class "$ACCESS_CLASS" \
    --acquisition-root "$ACQ_ROOT" \
    --output-dir "$OUTPUT_DIR" \
    --object-store "$OBJECT_STORE" \
    --producer-revision "$PRODUCER_REVISION"

  echo
  if [[ -f "$OUTPUT_DIR/census.json" ]]; then
    echo "Updated census: $OUTPUT_DIR/census.json"
  fi
  read -r -p "Observe another surface? [y/N]: " AGAIN
  case "$AGAIN" in
    y|Y|yes|YES) ;;
    *) break ;;
  esac
done

echo
if [[ -f "$OUTPUT_DIR/census.json" ]]; then
  echo "FACEBOOK-GRAPH0 census ready: $OUTPUT_DIR/census.json"
  read -r -p "Open the census in your default viewer? [y/N]: " OPEN_CENSUS
  case "$OPEN_CENSUS" in
    y|Y|yes|YES) open "$OUTPUT_DIR/census.json" ;;
  esac
else
  echo "No census exists yet; no normalized Facebook GraphQL observations were captured."
fi

PACK_BUILDER="$HERE/facebook_graph_evidence_pack.py"
if [[ -f "$OUTPUT_DIR/census.json" && -f "$PACK_BUILDER" ]]; then
  echo
  read -r -p "Build the full pinned Facebook evidence pack now? [Y/n]: " BUILD_PACK
  case "$BUILD_PACK" in
    n|N|no|NO)
      echo "Evidence-pack build skipped. The operator observations remain intact."
      ;;
    *)
      PACK_ARGS=(
        --operator-output "$OUTPUT_DIR"
        --object-store "$OBJECT_STORE"
        --acquisition-g0-root "$ACQ_ROOT"
      )
      if [[ -n "${COUNTERPEDIA_FB_STABILITY_ROOT:-}" ]]; then
        PACK_ARGS+=(--stability-root "$COUNTERPEDIA_FB_STABILITY_ROOT")
      fi
      if [[ -n "${COUNTERPEDIA_FB_DESCENT_ROOT:-}" ]]; then
        PACK_ARGS+=(--descent-root "$COUNTERPEDIA_FB_DESCENT_ROOT")
      fi
      if [[ -n "${COUNTERPEDIA_FB_REGISTRY_ROOT:-}" ]]; then
        PACK_ARGS+=(--registry-root "$COUNTERPEDIA_FB_REGISTRY_ROOT")
      fi

      echo "Building run-specific censuses, longitudinal report, outbound-reference sets, and REG0 crosswalk proposals ..."
      if PACK_MANIFEST="$("$PYTHON" "$PACK_BUILDER" "${PACK_ARGS[@]}")"; then
        PACK_DIR="$(dirname "$PACK_MANIFEST")"
        echo "FACEBOOK-EVIDENCE-PACK0 ready: $PACK_MANIFEST"
        read -r -p "Reveal the evidence pack in Finder? [Y/n]: " OPEN_PACK
        case "$OPEN_PACK" in
          n|N|no|NO) ;;
          *) open "$PACK_DIR" ;;
        esac
      else
        echo
        echo "FACEBOOK-EVIDENCE-PACK0 was not built. Your captured observations are unchanged." >&2
        echo "The pack builder fails closed when an exact #229/#230/#38 checkout/worktree is unavailable." >&2
        echo "See docs/FACEBOOK_EVIDENCE_PACK0_V0_1.md for the required pins or set:" >&2
        echo "  COUNTERPEDIA_FB_STABILITY_ROOT" >&2
        echo "  COUNTERPEDIA_FB_DESCENT_ROOT" >&2
        echo "  COUNTERPEDIA_FB_REGISTRY_ROOT" >&2
      fi
      ;;
  esac
fi

echo "Operator session complete. No merge, admission, or GRAPH1 authorization implied."
