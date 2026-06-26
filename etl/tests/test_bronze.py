"""Unit tests for the pure (DB-free) logic in load_bronze.py."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import load_bronze as lb  # noqa: E402


class TestHelpers(unittest.TestCase):
    def test_norm_header(self):
        self.assertEqual(lb.norm_header("POS Serial Number"), "pos serial number")
        self.assertEqual(lb.norm_header("MRC TRADING/ REGISTERED NAME"),
                         "mrc trading registered name")
        self.assertEqual(lb.norm_header(None), "")

    def test_jsonable_preserves_ids(self):
        # ID/phone-like floats must not become "9.13e8"
        self.assertEqual(lb.jsonable(913189156.0), "913189156")
        self.assertEqual(lb.jsonable(1.5), 1.5)
        self.assertEqual(lb.jsonable("  x "), "x")
        self.assertIsNone(lb.jsonable(None))

    def test_make_keys_unique(self):
        self.assertEqual(lb.make_keys(["A", "A", "", "B"]), ["A", "A__2", "col_3", "B"])

    def test_detect_header_picks_richest_row(self):
        rows = [["title", "", "", ""], ["id", "name", "phone"], ["1", "a", ""]]
        self.assertEqual(lb.detect_header(rows), 1)

    def test_detect_header_fallback_first_nonempty(self):
        rows = [["", ""], ["only-one"]]  # nothing has >=2 cells
        self.assertEqual(lb.detect_header(rows), 1)

    def test_row_nonempty(self):
        self.assertTrue(lb.row_nonempty(["", "x"]))
        self.assertFalse(lb.row_nonempty(["", None, "  "]))


if __name__ == "__main__":
    unittest.main()
