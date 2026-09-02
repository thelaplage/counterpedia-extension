import { projectAuthoringHandoffToReaderEntry } from "../lib/entryReadModelClient";
import { configureDraftReaderProjection } from "./draftFromSourceButton";
import { initDirectionalActions } from "./directionalActions";
import { initCheckHandoff } from "./checkHandoff";
import { initInquiryPaths } from "./inquiryPaths";
import { initInquiryTrace } from "./inquiryTrace";
import { initResearcherProfiles } from "./researcherProfiles";
import { initResearcherTeaching } from "./researcherTeaching";
import { initHistoryControls } from "./historyControls";
import { initWikipediaHarvestPanel } from "./wikipediaHarvest";
import { initWikipediaFrontierCapturePanel } from "./wikipediaFrontierCapture";
import { initOperatorSnapshotCapture } from "./operatorSnapshotCapture";

// Product semantics stay in Counterpedia: once Authoring returns a guarded
// proposal-only handoff, the draft dispatcher asks the local Counterpedia web
// service for the canonical EntryReadModel. The extension only lays that model
// out in the side panel.
configureDraftReaderProjection(projectAuthoringHandoffToReaderEntry);

// panel.ts performs its own module-time wiring, so load it only after the
// projection seam above is configured. All other panel initializers follow.
void import("./panel").then(() => {
  initDirectionalActions();
  void initCheckHandoff();
  initInquiryPaths();
  initInquiryTrace();
  initResearcherProfiles();
  initResearcherTeaching();
  void initHistoryControls();
  void initWikipediaHarvestPanel();
  void initWikipediaFrontierCapturePanel();
  initOperatorSnapshotCapture();
});
