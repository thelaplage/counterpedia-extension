/**
 * Draft-from-source button wiring — pure, DOM/chrome-free dispatch logic.
 *
 * The single button still calls ONLY draftFromHeldCapture(). READER-CONSUMER-
 * EXT1 adds one POST-success composition seam: once an Authoring handoff has
 * already been guarded and assembled, an injected Counterpedia reader
 * projector may turn that handoff into the canonical EntryReadModel. Projection
 * failure never retries Authoring, never fetches the source, and never rewrites
 * the proposal-only Authoring success into admission/publication.
 */

import type { AcquisitionCaptureResult } from "../lib/acquisitionResponseGuard";
import {
  getSelectedGovernedSource,
  subscribeGovernedSourceSelection,
} from "../lib/governedSourceSelection";
import type {
  AuthoringClient,
  OperatorDraftMaterial,
  AuthoringClientResult,
} from "../lib/authoringClient";
import type { AuthoringHandoff } from "../lib/authoringResponseGuard";
import type { ProposalReaderEntry } from "../lib/entryReadModelClient";
import {
  renderDraftUnavailable,
  renderDraftFailed,
  renderDraftPending,
  renderDraftReady,
  renderAuthoringClientResult,
  type AuthoringRender,
} from "../lib/authoringState";

export interface DraftFromSourceButtonLike {
  disabled?: boolean;
  addEventListener(type: "click", listener: () => void): void;
}

export type DraftReaderProjector = (
  handoff: AuthoringHandoff,
) => Promise<ProposalReaderEntry>;

let configuredReaderProjector: DraftReaderProjector | null = null;

/**
 * Configure the product read-model projector at the surface-composition entry
 * point. Null resets it for tests/non-authoring builds. This is transport
 * composition only; the extension never implements Authoring→EntryReadModel
 * semantics itself.
 */
export function configureDraftReaderProjection(
  projector: DraftReaderProjector | null,
): void {
  configuredReaderProjector = projector;
}

export interface DraftFromSourceDeps {
  readonly button: DraftFromSourceButtonLike;
  readonly getGovernedSource: () => AcquisitionCaptureResult | null;
  readonly setStatus: (render: AuthoringRender) => void;
  readonly readMaterial: () => OperatorDraftMaterial | null;
  readonly getClient: () => Promise<AuthoringClient>;
  /** Test/embedding override; otherwise the configured surface projector is used. */
  readonly projectHandoff?: DraftReaderProjector;
}

export function resolveDraftGovernedSource(
  deps: Pick<DraftFromSourceDeps, "getGovernedSource">,
): AcquisitionCaptureResult | null {
  return deps.getGovernedSource() ?? getSelectedGovernedSource();
}

export async function runDraftFromSource(deps: DraftFromSourceDeps): Promise<void> {
  const source = resolveDraftGovernedSource(deps);
  if (!source) {
    deps.setStatus(renderDraftUnavailable());
    return;
  }
  const material = deps.readMaterial();
  if (!material) {
    deps.setStatus(renderDraftFailed());
    return;
  }

  const client = await deps.getClient();
  if (client.kind === "not_configured") {
    deps.setStatus(renderAuthoringClientResult({ kind: "not_configured" }));
    return;
  }

  deps.setStatus(renderDraftPending());
  try {
    const result: AuthoringClientResult = await client.draftFromHeldCapture(
      source,
      material,
    );

    if (result.kind !== "assembled") {
      deps.setStatus(renderAuthoringClientResult(result));
      return;
    }

    const projector = deps.projectHandoff ?? configuredReaderProjector;
    if (!projector) {
      deps.setStatus(renderAuthoringClientResult(result));
      return;
    }

    try {
      const readerEntry = await projector(result.handoff);
      deps.setStatus(renderAuthoringClientResult(result, readerEntry));
    } catch {
      // Authoring succeeded. Preserve PROPOSAL_ASSEMBLED and disclose that the
      // separate Counterpedia reader projection is unavailable. Never retry the
      // draft, never call draftFromUrl(), never fetch the source.
      deps.setStatus(renderAuthoringClientResult(result, null, true));
    }
  } catch {
    deps.setStatus(renderDraftFailed());
  }
}

export function wireDraftFromSourceButton(deps: DraftFromSourceDeps): void {
  deps.button.addEventListener("click", () => {
    void runDraftFromSource(deps);
  });

  if (!("disabled" in deps.button)) return;

  if (resolveDraftGovernedSource(deps)) {
    deps.button.disabled = false;
    deps.setStatus(renderDraftReady());
  }

  subscribeGovernedSourceSelection((selected) => {
    if (deps.getGovernedSource()) return;
    if (!selected) {
      deps.button.disabled = true;
      deps.setStatus(renderDraftUnavailable());
      return;
    }
    deps.button.disabled = false;
    deps.setStatus(renderDraftReady());
  });
}
