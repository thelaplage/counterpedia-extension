import "./panel";
import { initHistoryControls } from "./historyControls";
import { initResearchSessionControls } from "./researchSessionControls";

async function initLocalResearchControls(): Promise<void> {
  await initHistoryControls();
  await initResearchSessionControls();
}

void initLocalResearchControls();
