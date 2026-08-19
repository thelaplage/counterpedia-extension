import { ingestOperatorSnapshot, type OperatorSnapshotIngestResult } from "../lib/operatorSnapshotClient";

const SECTION_ID = "counterpedia-operator-snapshot-section";
const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;

function teamBetaEnabled(): boolean {
  const manifest = chrome.runtime.getManifest() as unknown as Record<string, unknown>;
  return manifest["_local_companion_dev"] === true;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const part = bytes.subarray(offset, Math.min(offset + chunk, bytes.length));
    let piece = "";
    for (const value of part) piece += String.fromCharCode(value);
    binary += piece;
  }
  return btoa(binary);
}

function saveTabAsMhtml(tabId: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    chrome.pageCapture.saveAsMHTML({ tabId }, (blob) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!blob) {
        reject(new Error("Chrome returned no page snapshot"));
        return;
      }
      resolve(blob);
    });
  });
}

export async function captureActiveTabOperatorSnapshot(
  expectedUrl: string | null = null,
): Promise<OperatorSnapshotIngestResult> {
  const [before] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!before?.id || !before.url || !isHttpUrl(before.url)) {
    throw new Error("Open an HTTP(S) source page before capturing a browser snapshot.");
  }
  if (expectedUrl !== null && !isHttpUrl(expectedUrl)) {
    throw new Error("Expected source URL must be HTTP(S).");
  }

  const capturedAt = new Date().toISOString();
  const blob = await saveTabAsMhtml(before.id);
  if (blob.size <= 0) throw new Error("Chrome produced an empty page snapshot.");
  if (blob.size > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Browser snapshot exceeds the ${MAX_SNAPSHOT_BYTES} byte limit.`);
  }

  const after = await chrome.tabs.get(before.id);
  const currentUrl = after.url ?? before.url;
  if (!isHttpUrl(currentUrl)) throw new Error("Captured tab no longer has an HTTP(S) URL.");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return ingestOperatorSnapshot({
    snapshot_base64: bytesToBase64(bytes),
    current_url: currentUrl,
    expected_url: expectedUrl ?? before.url,
    captured_at: capturedAt,
    media_type: "multipart/related",
  });
}

function buildSection(): {
  section: HTMLElement;
  expected: HTMLInputElement;
  button: HTMLButtonElement;
  status: HTMLElement;
} {
  const section = document.createElement("section");
  section.id = SECTION_ID;
  section.setAttribute("aria-label", "Operator browser snapshot");
  section.style.border = "1px solid #d7dfdc";
  section.style.borderRadius = "9px";
  section.style.padding = "10px 12px";
  section.style.marginBottom = "12px";
  section.style.background = "#fbfcfb";

  const title = document.createElement("div");
  title.textContent = "Operator browser snapshot";
  title.style.fontWeight = "600";

  const explanation = document.createElement("p");
  explanation.textContent =
    "Explicitly retain what ordinary Chrome loaded. This is a browser page snapshot, not a strict HTTP CaptureReceipt and not verification.";
  explanation.style.fontSize = "12px";
  explanation.style.color = "#53615e";
  explanation.style.margin = "5px 0 8px";

  const expected = document.createElement("input");
  expected.type = "url";
  expected.placeholder = "Expected source URL (optional)";
  expected.setAttribute("aria-label", "Expected source URL");
  expected.style.width = "100%";
  expected.style.boxSizing = "border-box";
  expected.style.marginBottom = "7px";
  expected.style.padding = "6px 7px";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Capture browser snapshot";
  button.style.font = "inherit";
  button.style.border = "1px solid #8ca09a";
  button.style.borderRadius = "7px";
  button.style.background = "#fff";
  button.style.padding = "7px 10px";
  button.style.cursor = "pointer";

  const status = document.createElement("div");
  status.setAttribute("aria-live", "polite");
  status.style.fontSize = "12px";
  status.style.color = "#53615e";
  status.style.marginTop = "7px";
  status.textContent = "No snapshot captured.";

  section.append(title, explanation, expected, button, status);
  return { section, expected, button, status };
}

export function initOperatorSnapshotCapture(): void {
  if (!teamBetaEnabled() || document.getElementById(SECTION_ID)) return;
  const content = document.querySelector(".panel-content");
  if (!content) return;

  const ui = buildSection();
  content.prepend(ui.section);
  ui.button.addEventListener("click", () => {
    void (async () => {
      ui.button.disabled = true;
      ui.status.textContent = "Capturing current tab through Chrome…";
      try {
        const rawExpected = ui.expected.value.trim();
        const result = await captureActiveTabOperatorSnapshot(rawExpected || null);
        if (result.locator_continuity === "exact") {
          ui.status.textContent = `Snapshot retained · ${result.snapshot_ref}`;
        } else {
          ui.status.textContent = `Snapshot retained · locator changed · review required · ${result.snapshot_ref}`;
        }
      } catch (error) {
        ui.status.textContent = error instanceof Error ? error.message : "Operator snapshot failed.";
      } finally {
        ui.button.disabled = false;
      }
    })();
  });
}
