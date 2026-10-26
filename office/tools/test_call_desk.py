#!/usr/bin/env python3
"""Tests for call_desk.py: python3 office/tools/test_call_desk.py"""
import datetime as dt
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import call_desk as cd  # noqa: E402

NOW = dt.datetime(2026, 10, 26, 15, 0, tzinfo=dt.timezone.utc)


def lead(**kw):
    base = {"businessName": "X", "trade": "roofing", "town": "Owasso", "state": "OK", "phone": "918-555-0100", "status": "Researching"}
    base.update(kw)
    return base


class CallDeskTest(unittest.TestCase):
    def setUp(self):
        self.niches = cd.load_kit()["niches"]

    def test_niche_matching(self):
        self.assertEqual(cd.niche_of(lead(trade="roofing"), self.niches), "roofing")
        self.assertEqual(cd.niche_of(lead(trade="other", businessName="A-1 Stump Removal"), self.niches), "tree-service")
        self.assertEqual(cd.niche_of(lead(trade="mechanic"), self.niches), "auto-repair")
        self.assertEqual(cd.niche_of(lead(niche="hvac", trade="roofing"), self.niches), "hvac")
        self.assertIsNone(cd.niche_of(lead(trade="ice cream shop", businessName="Enjoy"), self.niches))

    def test_callable(self):
        self.assertTrue(cd.callable_lead(lead(), NOW))
        self.assertFalse(cd.callable_lead(lead(phone=""), NOW))
        self.assertFalse(cd.callable_lead(lead(status="Not a fit"), NOW))
        self.assertFalse(cd.callable_lead(lead(callStatus="Sold"), NOW))
        self.assertFalse(cd.callable_lead(lead(test=True), NOW))
        self.assertFalse(cd.callable_lead(lead(nextCallAt="2026-10-29T12:00:00Z"), NOW))
        self.assertTrue(cd.callable_lead(lead(nextCallAt="2026-10-27T01:00:00Z"), NOW))  # 8 PM Central the same day
        self.assertFalse(cd.callable_lead(lead(nextCallAt="2026-10-27T14:00:00Z"), NOW))  # tomorrow
        self.assertFalse(cd.callable_lead(lead(callStatus="Interested"), NOW))
        self.assertTrue(cd.callable_lead(lead(callStatus="Interested", nextCallAt="2026-10-26T20:00:00Z"), NOW))
        self.assertFalse(cd.callable_lead(lead(status="Contacted", touches=[{"t": "2026-10-26T12:00:00Z"}]), NOW))
        self.assertEqual(cd.call_status(lead(calls=[{"outcome": "no answer"}])), "Called")

    def test_stock_plan(self):
        leads = [lead(businessName="R%d" % i) for i in range(30)] + [lead(trade="plumber", businessName="P1")]
        r = cd.stock(leads, self.niches, NOW, ["Owasso, OK"], 25)
        self.assertEqual(r["perNiche"]["roofing"], 30)
        self.assertNotIn("roofing", [p["niche"] for p in r["plan"]])
        plumbing = [p for p in r["plan"] if p["niche"] == "plumbing"][0]
        self.assertEqual((plumbing["have"], plumbing["need"], plumbing["town"]), (1, 24, "Owasso, OK"))

    def test_stats(self):
        calls = [{"t": "2026-10-26T13:00:00Z", "outcome": "Interested", "pitchLine": "reviews", "niche": "roofing", "town": "Owasso, OK"},
                 {"t": "2026-10-26T13:05:00Z", "outcome": "no answer"},
                 {"t": "2026-10-26T13:10:00Z", "outcome": "Sold", "pitchLine": "reviews"}]
        r = cd.stats([lead(calls=calls), lead(test=True, calls=calls)], self.niches)
        self.assertEqual(r["calls"], 3)
        self.assertEqual(r["byNiche"]["roofing"]["interested"], 1)
        self.assertEqual(r["byNiche"]["roofing"]["sold"], 1)
        self.assertEqual(r["byNiche"]["roofing"]["talked"], 2)
        self.assertEqual(r["nicheOrder"][0], "roofing")
        self.assertTrue(r["tooEarly"])
        self.assertIsNone(r["bestLine"])

    def test_cli_reads_out_dir(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "leads"))
            with open(os.path.join(d, "leads", "a.json"), "w") as f:
                json.dump(lead(), f)
            self.assertEqual(len(cd.load_leads(d)), 1)
            self.assertEqual(cd.main(["stock", d, "--json"]), 0)
            self.assertEqual(cd.main(["stats", d]), 0)


if __name__ == "__main__":
    unittest.main()
