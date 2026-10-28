#!/usr/bin/env python3
"""Tests for ai_score.py: python3 office/tools/test_ai_score.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_score  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

CHATGPT_NAMED_FIRST = ("Here are the best plumbers in Cabot, AR:\n\n1. **Riverbend Plumbing Co.** - 4.9 stars\n"
                       "2. **Summit Plumbing & Drain** - fast service\n3. **Clearwater Plumbing**\n4. **Ace Pipe Co.**\n")
GEMINI_NAMED_LATE = ("Top picks:\n- Summit Plumbing & Drain\n- Clearwater Plumbing\n- Ace Pipe Co.\n- Hartley Heating & Plumbing\n"
                     "- Riverbend Plumbing Co.\n")
NOT_NAMED = "1. Summit Plumbing & Drain\n2. Clearwater Plumbing\n3. Ace Pipe Co.\n"


def answer(text, ok=True):
    return {"ok": ok, "text": text}


def out_file(dirname, results):
    path = os.path.join(dirname, "aicheck-test.json")
    with open(path, "w") as f:
        json.dump({"id": "aicheck-test", "at": "2026-10-28T12:00:00Z", "results": results}, f)
    return path


class AiScoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.three = out_file(self.tmp, [
            {"key": "q1", "chatgpt": answer(CHATGPT_NAMED_FIRST), "gemini": answer(GEMINI_NAMED_LATE)},   # 1 + 0.5
            {"key": "q2", "chatgpt": answer(NOT_NAMED), "gemini": answer(NOT_NAMED)},                      # 0 + 0
            {"key": "q3", "chatgpt": answer("", ok=False), "gemini": answer(CHATGPT_NAMED_FIRST)},          # 0 (errored) + 1
        ])

    def test_scoring_rules(self):
        r = ai_score.score("Riverbend Plumbing Co.", ["q1", "q2", "q3"], [self.three])
        self.assertEqual(r["answers"], 6)
        self.assertEqual(r["questions"], 3)
        self.assertEqual(r["points"], 2.5)
        self.assertEqual(r["score"], 42)  # round(2.5 / 6 * 100)
        self.assertNotIn("warning", r)
        by = {(d["key"], d["tool"]): d for d in r["detail"]}
        self.assertEqual(by[("q1", "chatgpt")]["rank"], 1)
        self.assertEqual(by[("q1", "gemini")]["rank"], 5)
        self.assertFalse(by[("q3", "chatgpt")]["ok"])
        self.assertEqual(by[("q3", "chatgpt")]["points"], 0)
        self.assertIn("Summit Plumbing & Drain", by[("q2", "chatgpt")]["competitors"])

    def test_one_question_warns(self):
        r = ai_score.score("Riverbend Plumbing Co.", ["q1"], [self.three])
        self.assertEqual(r["questions"], 1)
        self.assertEqual(r["answers"], 2)
        self.assertEqual(r["score"], 75)  # 1 + 0.5 of 2
        self.assertIn("warning", r)
        self.assertIn("1 question (2 answers)", r["warning"])
        self.assertIn("first check, not the baseline", r["warning"])

    def test_two_questions_warn_three_do_not(self):
        self.assertIn("2 questions (4 answers)", ai_score.few_questions_warning(2))
        self.assertIsNone(ai_score.few_questions_warning(3))
        self.assertIsNone(ai_score.few_questions_warning(4))

    def test_missing_key_is_an_error(self):
        with self.assertRaises(SystemExit) as cm:
            ai_score.score("Riverbend Plumbing Co.", ["q1", "nope"], [self.three])
        self.assertIn("missing keys", str(cm.exception.code))

    def test_cli_prints_warning_to_stderr_and_json_to_stdout(self):
        p = subprocess.run([sys.executable, "-I", os.path.join(HERE, "ai_score.py"), "--name", "Riverbend Plumbing Co.",
                            "--keys", "q1", self.three], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(p.stderr.startswith("WARNING: scored 1 question"), p.stderr)
        j = json.loads(p.stdout)
        self.assertEqual(j["score"], 75)
        self.assertIn("warning", j)
        p3 = subprocess.run([sys.executable, "-I", os.path.join(HERE, "ai_score.py"), "--name", "Riverbend Plumbing Co.",
                             "--keys", "q1,q2,q3", self.three], capture_output=True, text=True)
        self.assertEqual(p3.returncode, 0, p3.stderr)
        self.assertEqual(p3.stderr, "")
        self.assertNotIn("warning", json.loads(p3.stdout))


if __name__ == "__main__":
    unittest.main()
