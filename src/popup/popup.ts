/**
 * Counterpedia Popup — minimal entry point.
 * Opens the side panel when the user clicks the button.
 */

document.getElementById("open-panel")?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  }
});
