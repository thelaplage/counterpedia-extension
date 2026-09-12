from __future__ import annotations

import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "Start Counterpedia Demo.command"


class StartDemoLauncherContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SCRIPT.read_text(encoding="utf-8")

    def test_dist_is_always_rebuilt_from_current_checkout(self):
        self.assertIn(
            'echo "Building unpacked extension (authoring-dev) from current checkout…"',
            self.text,
        )
        self.assertIn("npm run build:authoring-dev", self.text)
        self.assertNotIn("FORCE_REBUILD", self.text)
        self.assertIn("claim_support_assessment_set", self.text)

    def test_foreign_8790_is_refused_before_local_spawn(self):
        guard = self.text.index("if port_accepting 8790; then")
        spawn = self.text.index('nohup "$PYTHON" counterpedia_local_operator.py')
        self.assertLess(guard, spawn)
        between = self.text[guard:spawn]
        self.assertIn("this launcher will not reuse or kill it", between)

    def test_readiness_checks_spawned_pid_before_and_after_health(self):
        loop = self.text[self.text.index("for _ in $(seq 1 40); do") :]
        first_pid_check = loop.index('if ! kill -0 "$LOCAL_PID"')
        health = loop.index('if curl -fsS "http://127.0.0.1:8790/healthz"')
        second_pid_check = loop.index('if ! kill -0 "$LOCAL_PID"', first_pid_check + 1)
        self.assertLess(first_pid_check, health)
        self.assertLess(health, second_pid_check)

    def test_local_demo_dagr_factory_and_evidence_dir_are_explicit(self):
        self.assertIn(
            "dagr_mcp_local_demo.counterpedia_acquisition:build_adapter",
            self.text,
        )
        self.assertIn("COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR", self.text)
        self.assertIn("dagr_mcp_sdk_binding.adapter", self.text)
        self.assertIn('if [[ -n "${OPENAI_API_KEY:-}" ]]; then', self.text)

    def test_selected_authoring_checkout_must_have_v05_source_path(self):
        self.assertIn(
            'src/counterpedia_authoring/draft_source_v05.py',
            self.text,
        )
        self.assertIn('export COUNTERPEDIA_AUTHORING_DIR="$AUTHORING_DIR"', self.text)


if __name__ == "__main__":
    unittest.main()
