import unittest

from aggregate import Aggregator, Frame, LOW_VALENCE, MIN_FACE_S, MIN_MINUTES, session_summary


def frames(t0, n, hz=5.0, valence=0.0, happy=0.0, ok=True):
    return [Frame(t=t0 + i / hz, ok=ok, valence=valence, arousal=0.0, happy=happy) for i in range(n)]


class MinuteTest(unittest.TestCase):
    def feed(self, fs):
        agg, out = Aggregator(), []
        for f in fs:
            m = agg.add(f)
            if m:
                out.append(m)
        return agg, out

    def test_minute_closes_when_next_minute_starts(self):
        _, out = self.feed(frames(0, 300) + frames(60, 1))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["t0"], 0)
        self.assertEqual(out[0]["n"], 300)
        self.assertAlmostEqual(out[0]["face_s"], 60, delta=0.5)

    def test_median_is_robust_to_a_few_outlier_frames(self):
        _, out = self.feed(frames(0, 290, valence=0.1) + frames(58, 10, valence=-0.9) + frames(60, 1))
        self.assertAlmostEqual(out[0]["valence_med"], 0.1)

    def test_shares(self):
        fs = frames(0, 150, valence=LOW_VALENCE - 0.1) + frames(30, 150, valence=0.3, happy=0.9) + frames(60, 1)
        _, out = self.feed(fs)
        self.assertAlmostEqual(out[0]["low_share"], 0.5, places=2)
        self.assertAlmostEqual(out[0]["smile_share"], 0.5, places=2)

    def test_frames_without_usable_face_count_no_face_time_and_no_values(self):
        _, out = self.feed(frames(0, 300, ok=False) + frames(60, 1))
        self.assertEqual(out[0]["face_s"], 0)
        self.assertIsNone(out[0]["valence_med"])
        self.assertFalse(out[0]["valid"])

    def test_face_time_does_not_bridge_gaps(self):
        # 10 s of face, 40 s away, 10 s of face: 20 s, not 60
        _, out = self.feed(frames(0, 50) + frames(50, 50) + frames(60, 1))
        self.assertAlmostEqual(out[0]["face_s"], 20, delta=1)

    def test_minute_below_min_face_time_is_not_valid(self):
        n = int((MIN_FACE_S - 5) * 5)
        _, out = self.feed(frames(0, n) + frames(60, 1))
        self.assertFalse(out[0]["valid"])

    def test_variability_zero_for_flat_and_positive_for_moving_face(self):
        _, flat = self.feed(frames(0, 300, valence=0.2) + frames(60, 1))
        moving = [Frame(t=i / 5, ok=True, valence=0.4 * (i % 10 < 5), arousal=0, happy=0) for i in range(300)]
        _, mov = self.feed(moving + frames(60, 1))
        self.assertEqual(flat[0]["variability"], 0)
        self.assertGreater(mov[0]["variability"], 0.05)

    def test_skipped_minutes_are_not_emitted(self):
        _, out = self.feed(frames(0, 300) + frames(600, 300) + frames(660, 1))
        self.assertEqual([m["t0"] for m in out], [0, 600])


class BlendTest(unittest.TestCase):
    def test_minute_carries_blendshape_means_and_shares(self):
        agg, out = Aggregator(), []
        for i in range(300):
            b = {"smile": 0.8 if i < 75 else 0.1, "browDown": 0.0, "jawOpen": 0.0, "animation": 0.2}
            agg.add(Frame(t=i / 5, ok=True, blend=b))
        m = agg.add(Frame(t=60, ok=True))
        self.assertAlmostEqual(m["blend"]["smile_share"], 0.25)
        self.assertAlmostEqual(m["blend"]["smile"], 0.275)
        self.assertEqual(m["blend"]["brow_share"], 0)
        self.assertAlmostEqual(m["blend"]["animation"], 0.2)


class SessionTest(unittest.TestCase):
    def minute(self, t0, v, valid=True):
        return {"t0": t0, "valid": valid, "face_s": 50, "valence_med": v, "low_share": 0.1, "smile_share": 0.2, "variability": 0.05}

    def test_needs_enough_valid_minutes(self):
        s = session_summary([self.minute(60 * i, 0.1) for i in range(MIN_MINUTES - 1)])
        self.assertFalse(s["enough"])
        s = session_summary([self.minute(60 * i, 0.1) for i in range(MIN_MINUTES)])
        self.assertTrue(s["enough"])

    def test_uses_valid_minutes_only_and_reports_spread(self):
        ms = [self.minute(60 * i, v) for i, v in enumerate([0.0, 0.1, 0.2, 0.3, 0.4])] + [self.minute(600, -0.9, valid=False)]
        s = session_summary(ms)
        self.assertEqual(s["minutes"], 5)
        self.assertAlmostEqual(s["valence_med"], 0.2)
        self.assertAlmostEqual(s["valence_iqr"][0], 0.1)
        self.assertAlmostEqual(s["valence_iqr"][1], 0.3)
        self.assertAlmostEqual(s["face_min"], 250 / 60)

    def test_empty(self):
        s = session_summary([])
        self.assertFalse(s["enough"])
        self.assertIsNone(s["valence_med"])


if __name__ == "__main__":
    unittest.main()
