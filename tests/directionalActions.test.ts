import { describe, expect, it } from "vitest";
import { projectDirectionalActions } from "../src/lib/directionalActions";

describe("directional action vocabulary", () => {
  it("starts with CHECK available and does not pretend KEEP has material", () => {
    const actions = projectDirectionalActions({
      hasCheckMaterial: false,
      hasKeepableMaterial: false,
    });
    expect(actions.find((action) => action.id === "check")?.state).toBe("available");
    expect(actions.find((action) => action.id === "keep")?.state).toBe("held");
  });

  it("makes KEEP available after Check material exists", () => {
    const actions = projectDirectionalActions({
      hasCheckMaterial: true,
      hasKeepableMaterial: true,
    });
    expect(actions.find((action) => action.id === "check")?.state).toBe("current");
    expect(actions.find((action) => action.id === "keep")?.state).toBe("available");
  });

  it("keeps USE PUBLISH SHARE REFUSE mechanically held in v0.1", () => {
    const actions = projectDirectionalActions({
      hasCheckMaterial: true,
      hasKeepableMaterial: true,
    });
    for (const id of ["use", "publish", "share", "refuse"] as const) {
      const action = actions.find((candidate) => candidate.id === id);
      expect(action?.state).toBe("held");
      expect(action?.holdReason).toBeTruthy();
    }
  });
});
