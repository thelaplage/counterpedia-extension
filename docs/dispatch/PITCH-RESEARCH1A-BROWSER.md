# PITCH-RESEARCH1A — browser → real acquisition

Tracking: #48 · producer companion: `counterpedia-acquisition#157`

## Mission
Replace the demo's configured/unavailable acquisition seam with an optional real localhost client while preserving the honest unavailable posture when no service is configured.

## Required flow
browser observation/selection → configured HTTP client → real acquisition producer → capture/source/digest/object-address facts → validated panel state.

## Rules
- no hard-coded localhost URL
- no standing/verified/published/admitted synthesis
- response guard remains even if server validates too
- acquisition refusal keeps the browser observation and creates no fake receipt/anchor
- absent config keeps existing `notConfigured`/unavailable behavior

## Cross-process gate
Vitest/Node spawns the real producer server and fixture source, calls `fetch()`, receives real serialized producer output, and asserts the exact expected SHA-256. Cover wrong origin/token, injection, contaminated response, producer refusal, and unavailable client.

## Stop
Once capture is real cross-process, hand the validated result to `Draft from source`; do not continue polishing acquisition infrastructure.