/**
 * Product vocabulary for the Counterpedia directional action strip.
 *
 * The vocabulary is broader than the currently implemented capabilities.
 * A HELD action is rendered as unavailable; naming it here MUST NOT be read as
 * implementing, authorizing, or granting that operation.
 */

export type DirectionalActionId =
  | "check"
  | "keep"
  | "use"
  | "publish"
  | "share"
  | "refuse";

export type DirectionalActionState = "available" | "current" | "held";

export interface DirectionalActionProjection {
  id: DirectionalActionId;
  label: string;
  state: DirectionalActionState;
  description: string;
  holdReason: string | null;
}

const DEFINITIONS: Record<
  DirectionalActionId,
  { label: string; description: string }
> = {
  check: { label: "CHECK", description: "What does this support?" },
  keep: { label: "KEEP", description: "Keep this in my private research trail." },
  use: { label: "USE", description: "Allow this for the current AI or task." },
  publish: { label: "PUBLISH", description: "Propose a bounded public version." },
  share: { label: "SHARE", description: "Send a governed projection or bundle." },
  refuse: { label: "REFUSE", description: "Record a governed refusal." },
};

export interface DirectionalActionContext {
  hasCheckMaterial: boolean;
  hasKeepableMaterial: boolean;
}

export function projectDirectionalActions(
  context: DirectionalActionContext,
): DirectionalActionProjection[] {
  return [
    {
      id: "check",
      ...DEFINITIONS.check,
      state: context.hasCheckMaterial ? "current" : "available",
      holdReason: null,
    },
    {
      id: "keep",
      ...DEFINITIONS.keep,
      state: context.hasKeepableMaterial ? "available" : "held",
      holdReason: context.hasKeepableMaterial ? null : "Nothing to keep yet.",
    },
    {
      id: "use",
      ...DEFINITIONS.use,
      state: "held",
      holdReason: "Governed agent-use boundary is not wired in this lane.",
    },
    {
      id: "publish",
      ...DEFINITIONS.publish,
      state: "held",
      holdReason: "Public projection/promotion boundary is not wired in this lane.",
    },
    {
      id: "share",
      ...DEFINITIONS.share,
      state: "held",
      holdReason: "Governed bundle/share boundary is not wired in this lane.",
    },
    {
      id: "refuse",
      ...DEFINITIONS.refuse,
      state: "held",
      holdReason: "Amnesiac/ShadowGraph refusal boundary is not wired in this lane.",
    },
  ];
}
