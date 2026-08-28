#!/usr/bin/env python3
"""Unit tests for SELF-LOAD0's demo_browser.py resolver + id computation.

Pure logic tests -- no real browser, no real Playwright cache. Run:
  python3 tools/counterpedia-local/test_demo_browser.py -v
"""
from __future__ import annotations

import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_browser as db  # noqa: E402


class ComputeStableExtensionIdTests(unittest.TestCase):
    def test_known_vector_matches_chrome_algorithm(self) -> None:
        # A minimal, well-known DER SPKI blob is unnecessary here -- what
        # matters is the algorithm: first 32 hex chars of SHA-256(der),
        # each hex digit mapped 0-9a-f -> a-p (digit + 'a').
        der = b"not a real key, just deterministic bytes for the algorithm test"
        result = db.compute_stable_extension_id(der)
        self.assertEqual(len(result), 32)
        self.assertTrue(all("a" <= c <= "p" for c in result))

        import hashlib

        expected_hex = hashlib.sha256(der).hexdigest()[:32]
        expected = "".join(chr(ord("a") + int(c, 16)) for c in expected_hex)
        self.assertEqual(result, expected)

    def test_deterministic_across_calls(self) -> None:
        der = b"same bytes every time"
        self.assertEqual(db.compute_stable_extension_id(der), db.compute_stable_extension_id(der))

    def test_different_keys_different_ids(self) -> None:
        self.assertNotEqual(
            db.compute_stable_extension_id(b"key one"),
            db.compute_stable_extension_id(b"key two"),
        )

    def test_from_generated_rsa_private_key_pem(self) -> None:
        import subprocess

        with tempfile.TemporaryDirectory() as tmp:
            priv = Path(tmp) / "k.pem"
            subprocess.run(
                ["openssl", "genrsa", "-out", str(priv), "2048"],
                check=True,
                capture_output=True,
            )
            pub_der = subprocess.run(
                ["openssl", "rsa", "-in", str(priv), "-pubout", "-outform", "DER"],
                check=True,
                capture_output=True,
            ).stdout

            expected = db.compute_stable_extension_id(pub_der)
            actual = db.compute_stable_extension_id_from_pem(priv.read_bytes())
            self.assertEqual(actual, expected)
            self.assertRegex(actual, r"^[a-p]{32}$")


class ResolveDemoBrowserTests(unittest.TestCase):
    def test_env_override_used_when_present_and_executable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "fake-chrome"
            fake.write_text("#!/bin/sh\n")
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            resolved = db.resolve_demo_browser({db.DEMO_BROWSER_ENV: str(fake)})
            self.assertEqual(resolved, fake)

    def test_env_override_missing_file_raises(self) -> None:
        with self.assertRaises(db.DemoBrowserNotFoundError):
            db.resolve_demo_browser({db.DEMO_BROWSER_ENV: "/nonexistent/path/to/chrome"})

    def test_env_override_non_executable_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "not-executable"
            fake.write_text("nope")
            with self.assertRaises(db.DemoBrowserNotFoundError):
                db.resolve_demo_browser({db.DEMO_BROWSER_ENV: str(fake)})

    def test_no_override_and_no_cache_raises_actionable_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            empty_cache = Path(tmp) / "ms-playwright"
            empty_cache.mkdir()
            orig = db.PLAYWRIGHT_CACHE_ROOT
            db.PLAYWRIGHT_CACHE_ROOT = empty_cache
            try:
                with self.assertRaises(db.DemoBrowserNotFoundError) as ctx:
                    db.resolve_demo_browser({})
                self.assertIn("npx", str(ctx.exception))
            finally:
                db.PLAYWRIGHT_CACHE_ROOT = orig

    def test_picks_newest_build_by_number_not_lexical_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_root = Path(tmp)
            # Lexical order would put "chromium-999" before "chromium-1234"
            # incorrectly if compared as strings; numeric parse must win.
            for build in ("chromium-999", "chromium-1234", "chromium-120"):
                binary = cache_root / build / db.CFT_RELATIVE_PATH
                binary.parent.mkdir(parents=True, exist_ok=True)
                binary.write_text("#!/bin/sh\n")
                binary.chmod(binary.stat().st_mode | stat.S_IEXEC)

            found = db._newest_playwright_chromium_cft(cache_root)
            self.assertIsNotNone(found)
            self.assertIn("chromium-1234", str(found))

    def test_ignores_build_dir_missing_binary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_root = Path(tmp)
            (cache_root / "chromium-500").mkdir()  # no binary inside
            self.assertIsNone(db._newest_playwright_chromium_cft(cache_root))

    def test_never_falls_back_to_daily_chrome(self) -> None:
        # Regression guard for the explicit "never silently fall back to the
        # user's daily Chrome" requirement: with no override and an empty
        # cache, resolution must raise, not return some other guessed path.
        with tempfile.TemporaryDirectory() as tmp:
            empty_cache = Path(tmp)
            orig = db.PLAYWRIGHT_CACHE_ROOT
            db.PLAYWRIGHT_CACHE_ROOT = empty_cache
            try:
                with self.assertRaises(db.DemoBrowserNotFoundError):
                    db.resolve_demo_browser({})
            finally:
                db.PLAYWRIGHT_CACHE_ROOT = orig


class ChromeComponentExtensionIdsTests(unittest.TestCase):
    def test_denylist_ids_are_well_formed(self) -> None:
        for ext_id in db.CHROME_COMPONENT_EXTENSION_IDS:
            self.assertRegex(ext_id, r"^[a-p]{32}$")


if __name__ == "__main__":
    unittest.main()
