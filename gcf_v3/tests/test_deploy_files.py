"""Packaging and deploy files (spec §11.1, §11.3, §11.4): read as text, never executed."""

import os
import re
import subprocess
import unittest

GCF_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(GCF_V3)


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


class Packaging(unittest.TestCase):
    def test_requirements_pin_ortools_with_v2_and_add_the_framework(self):
        lines = [l for l in read(GCF_V3, "requirements.txt").splitlines() if l and not l.startswith("#")]
        self.assertEqual(lines, ["ortools==9.15.6755", "functions-framework>=3.0,<4"])
        v2 = [l for l in read(ROOT, "gcf", "requirements.txt").splitlines() if l.startswith("ortools")]
        self.assertEqual(v2, ["ortools==9.15.6755"])

    def test_gcloudignore_keeps_tests_harness_and_build_config_out(self):
        lines = read(GCF_V3, ".gcloudignore").splitlines()
        for entry in ("test_*.py", "tests/", "acceptance/", "cloudbuild.yaml"):
            self.assertIn(entry, lines)

    def test_cloudbuild_deploys_only_v3_with_the_contract_flags(self):
        args = re.findall(r"^\s+- (\S+)$", read(GCF_V3, "cloudbuild.yaml"), re.M)
        for flag in ("owt-solver-v3", "--gen2", "--region=us-central1", "--runtime=python312", "--source=gcf_v3",
                     "--entry-point=solve", "--trigger-http", "--memory=512MB", "--cpu=1", "--timeout=120s",
                     "--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest",
                     "--set-env-vars=OWT_SOLVER_V3_BUILD=$COMMIT_SHA"):
            self.assertIn(flag, args)
        self.assertNotIn("--allow-unauthenticated", args)
        self.assertFalse([a for a in args if a.startswith("--remove-env-vars")])
        self.assertNotIn("owt-solver", [a for a in args if a != "owt-solver-v3" and a.startswith("owt-solver")])

    def test_the_manual_script(self):
        text = read(ROOT, "scripts", "deploy-solver-v3-gcf.sh")
        for needle in ("gcloud functions deploy owt-solver-v3", "--gen2", "--source=gcf_v3", "--allow-unauthenticated",
                       'OWT_SOLVER_V3_BUILD=$BUILD', 'BUILD="$(git rev-parse HEAD)"',
                       "git status --porcelain -- gcf_v3", "CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true",
                       "--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest"):
            self.assertIn(needle, text)
        self.assertNotRegex(text, r"deploy owt-solver[^-]|--source=gcf[^_]")
        self.assertEqual(subprocess.run(["bash", "-n", os.path.join(ROOT, "scripts", "deploy-solver-v3-gcf.sh")])
                         .returncode, 0)


if __name__ == "__main__":
    unittest.main()
