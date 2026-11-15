import unittest

from aggregate import CLASSES
from signals import COOLDOWN_MIN, MIN_BASELINE, baseline, checkin, context, face_during, fuse, history, usual


def minute(i, v=0.0, low=0.1, valid=True, top="Neutral"):
    labels = {c: 0.05 for c in CLASSES}
    labels[top] = 0.65
    return {"t0": 60 * i, "valid": valid, "face_s": 50, "valence_med": v, "low_share": low, "smile_share": 0.1,
            "variability": 0.05, "labels": labels, "blend": None}


def day(n, v=0.0, spread=0.1):
    """n minutes whose valence cycles evenly through [v - spread, v + spread]."""
    return [minute(i, v + spread * ((i % 11) - 5) / 5) for i in range(n)]


class CheckinTest(unittest.TestCase):
    def test_no_checkin_on_a_usual_stretch(self):
        ms = day(MIN_BASELINE + 60)
        self.assertIsNone(checkin(ms, now=ms[-1]["t0"]))

    def test_checkin_when_last_30_min_are_below_own_usual(self):
        ms = day(MIN_BASELINE + 30) + [minute(MIN_BASELINE + 30 + i, v=-0.4) for i in range(30)]
        c = checkin(ms, now=ms[-1]["t0"])
        self.assertEqual(c["reason"], "below-own-usual")

    def test_a_person_who_always_looks_serious_is_not_flagged(self):
        ms = day(MIN_BASELINE + 60, v=-0.4)  # low in absolute terms, but that is their usual
        self.assertIsNone(checkin(ms, now=ms[-1]["t0"]))

    def test_a_few_low_minutes_do_not_trigger(self):
        ms = day(MIN_BASELINE + 30) + [minute(MIN_BASELINE + 30 + i, v=-0.4 if i < 5 else 0.0) for i in range(30)]
        self.assertIsNone(checkin(ms, now=ms[-1]["t0"]))

    def test_needs_enough_valid_minutes_in_window(self):
        ms = day(MIN_BASELINE + 30) + [minute(MIN_BASELINE + 30 + i, v=-0.4, valid=i < 5) for i in range(30)]
        self.assertIsNone(checkin(ms, now=ms[-1]["t0"]))

    def test_cooldown(self):
        ms = day(MIN_BASELINE + 30) + [minute(MIN_BASELINE + 30 + i, v=-0.4) for i in range(30)]
        now = ms[-1]["t0"]
        self.assertIsNone(checkin(ms, now, last_checkin=now - 60 * (COOLDOWN_MIN - 1)))
        self.assertIsNotNone(checkin(ms, now, last_checkin=now - 60 * (COOLDOWN_MIN + 1)))

    def test_no_baseline_means_no_checkin_even_if_the_face_looks_low(self):
        self.assertIsNone(checkin([minute(i, v=-0.4, low=0.9) for i in range(60)], now=60 * 59))

    def test_short_demo_settings(self):
        ms = [minute(i, 0.02 * (i % 5)) for i in range(12)] + [minute(12 + i, v=-0.4) for i in range(3)]
        self.assertIsNone(checkin(ms, now=ms[-1]["t0"]))
        self.assertIsNotNone(checkin(ms, now=ms[-1]["t0"], window_min=3, min_baseline=10))

    def test_usual_needs_history(self):
        self.assertIsNone(usual(day(MIN_BASELINE - 1), before=1e9))
        u = usual(day(MIN_BASELINE * 2), before=1e9)
        self.assertLess(u["low"], u["median"])
        self.assertLess(u["median"], u["high"])


class ContextTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(context([], now=0)["text"], "No face seen recently.")

    def test_text_names_top_labels_and_usual(self):
        ms = day(MIN_BASELINE + 30) + [minute(MIN_BASELINE + 30 + i, v=-0.4, top="Sadness") for i in range(10)]
        c = context(ms, now=ms[-1]["t0"], live={"label": "Sadness", "confidence": 0.7, "valence": -0.4})
        self.assertEqual(c["recent"]["top"][0][0], "Sadness")
        self.assertEqual(c["vs_usual"], "below")
        self.assertIn("mostly sadness", c["text"])
        self.assertIn("Less positive than this person's usual", c["text"])
        self.assertNotIn("depress", c["text"].lower())


class HistoryTest(unittest.TestCase):
    def test_hourly_buckets_skip_invalid_minutes(self):
        ms = [minute(i, v=0.1) for i in range(60)] + [minute(60 + i, v=-0.3, valid=i < 30) for i in range(60)]
        h = history(ms)
        self.assertEqual([r["t0"] for r in h], [0, 3600])
        self.assertEqual(h[1]["minutes"], 30)
        self.assertAlmostEqual(h[1]["valence_med"], -0.3)
        self.assertAlmostEqual(h[0]["labels"]["Neutral"], 0.65)


class FuseTest(unittest.TestCase):
    def frames(self, t0, n, cls, valence):
        p = [0.05] * 8
        p[CLASSES.index(cls)] = 0.65
        return [(t0 + i / 5, p, valence) for i in range(n)]

    def test_face_during_uses_only_the_utterance_window(self):
        fs = self.frames(0, 25, "Happiness", 0.6) + self.frames(5, 25, "Sadness", -0.4)
        f = face_during(fs, 5, 10)
        self.assertEqual(f["label"], "Sadness")
        self.assertAlmostEqual(f["valence"], -0.4)
        self.assertEqual(f["smile_share"], 0)

    def test_face_not_in_view(self):
        self.assertIsNone(face_during(self.frames(0, 25, "Neutral", 0), 100, 105))
        self.assertIn("not in view", fuse("hello", None, "No face seen recently."))

    def test_fuse_keeps_words_and_marks_face_as_a_hint(self):
        t = fuse("I'm fine", face_during(self.frames(0, 25, "Sadness", -0.4), 0, 5), "Trend.")
        self.assertIn('"I\'m fine"', t)
        self.assertIn("mostly sadness", t)
        self.assertIn("weak hint", t)


class BaselineTest(unittest.TestCase):
    def test_percentiles_counts_and_labels(self):
        ms = day(40) + [minute(100, valid=False)]
        for m in ms:
            m["blend"] = {"smile_share": 0.2, "animation": 0.1}
        b = baseline(ms)
        self.assertEqual((b["n_minutes"], b["n_valid"]), (41, 40))
        self.assertAlmostEqual(b["face_minutes"], 40 * 50 / 60, places=1)
        v = b["valence_med"]
        self.assertLess(v["p10"], v["p50"])
        self.assertLess(v["p50"], v["p90"])
        self.assertEqual(b["blend.animation"]["p50"], 0.1)
        self.assertAlmostEqual(b["labels"]["Neutral"], 0.65)

    def test_empty_and_missing_blend(self):
        self.assertIsNone(baseline([minute(0, valid=False)]))
        b = baseline(day(5))
        self.assertIsNone(b["blend.animation"])


if __name__ == "__main__":
    unittest.main()
