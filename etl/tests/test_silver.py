"""Unit tests for the pure (DB-free) logic in build_silver.py."""
import os, sys, unittest, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_silver as bs  # noqa: E402


class TestCoercion(unittest.TestCase):
    def test_num(self):
        self.assertEqual(bs.num("1,234.5"), 1234.5)
        self.assertEqual(bs.num("47%"), 47.0)
        self.assertEqual(bs.num("0.47"), 0.47)
        self.assertIsNone(bs.num(""))
        self.assertIsNone(bs.num("n/a"))
        self.assertIsNone(bs.num("abc"))

    def test_intval(self):
        self.assertEqual(bs.intval("5.0"), 5)
        self.assertEqual(bs.intval("12"), 12)
        self.assertIsNone(bs.intval(""))

    def test_boolean(self):
        for t in ("Yes", "true", "1", "settled", "DONE"):
            self.assertIs(bs.boolean(t), True)
        for f in ("no", "false", "0"):
            self.assertIs(bs.boolean(f), False)
        self.assertIsNone(bs.boolean("maybe"))

    def test_dates(self):
        self.assertEqual(bs.to_date("2025-05-20"), datetime.date(2025, 5, 20))
        self.assertIsNone(bs.to_date(""))
        self.assertIsInstance(bs.to_ts("2026-06-25 09:00:00"), datetime.datetime)

    def test_clean_code(self):
        self.assertEqual(bs.clean_code("396973/"), "396973")
        self.assertEqual(bs.clean_code(" sp001102 "), "SP001102")
        self.assertIsNone(bs.clean_code(""))


class TestBankCanon(unittest.TestCase):
    def test_variants_collapse(self):
        cases = {
            "AWASH BANK": "Awash Bank",
            "awash": "Awash Bank",
            "CBE": "Commercial Bank of Ethiopia",
            "Commercial Bank of Ethiopia S.C": "Commercial Bank of Ethiopia",
            "oromiya bank": "Oromia Bank",
            "0romya": "Oromia Bank",
            "anbessa": "Lion Bank",
            "BUNA": "Bunna Bank",
            "Zemzem": "ZamZam Bank",
        }
        for raw, want in cases.items():
            self.assertEqual(bs.canon_bank(raw), want, raw)

    def test_unknown_passthrough(self):
        self.assertEqual(bs.canon_bank("Totally Unknown Bank"), "Totally Unknown Bank")


class TestMapping(unittest.TestCase):
    def test_rownorm_and_build(self):
        data = {"MRC TRADING/ REGISTERED NAME": "Beemnet Bar", "PHONE": "0911", "": ""}
        rn = bs.rownorm(data)
        self.assertEqual(rn["mrc trading registered name"], "Beemnet Bar")
        rec = bs.build(bs.MERCHANTS, rn)
        self.assertEqual(rec["trading_name"], "Beemnet Bar")
        self.assertEqual(rec["phone"], "0911")

    def test_attrs_only_unmapped(self):
        data = {"Terminal ID": "TP1", "Weird Column": "keep-me"}
        attrs = bs.attrs_of(data)
        self.assertIn("Weird Column", attrs)
        self.assertNotIn("Terminal ID", attrs)  # mapped -> not in overflow


class TestQualify(unittest.TestCase):
    def test_device_snapshot(self):
        sig = {"terminalid", "serialnumber", "batterylevel", "devicestatus",
               "lastaccesstime", "merchantid"}
        q = bs.qualifies(sig, "1755091398662806840pos-device-report.xlsx")
        self.assertIn("pos_devices", q)
        self.assertIn("device_telemetry", q)

    def test_txn_summary(self):
        sig = {"terminalid", "merchantid", "totaltransactioncount",
               "gatewaytransactioncount", "santimpaycommission"}
        self.assertIn("transaction_summaries", bs.qualifies(sig, "key-merchant-transactions.xlsx"))

    def test_sim(self):
        sig = {"customer name", "service number", "sn"}
        self.assertIn("sim_cards", bs.qualifies(sig, "Santimpay Mobile postpaid data.xlsx"))

    def test_return_assignment(self):
        sig = {"terminal id", "serial", "recived by"}
        q = bs.qualifies(sig, "Retured POS on date 16.07.2025.xlsx")
        self.assertIn("device_assignments", q)

    def test_junk_sheet_yields_nothing(self):
        self.assertEqual(bs.qualifies({"sheet1"}, "Untitled spreadsheet.xlsx"), set())


if __name__ == "__main__":
    unittest.main()
