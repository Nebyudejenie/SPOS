#!/usr/bin/env python3
"""
Phase 2 — Silver ETL.

Reads the bronze layer (spos.raw_rows) and maps it into the typed silver tables,
driven by a comprehensive header->field mapping plus identity resolution:
  * merchants  resolved by merchant_code | qr_merchant_id | (trading_name+phone)
  * devices    resolved by serial_number | terminal_id | psn
Unmapped columns are preserved per row in `attributes`; every row carries
`source_ref` lineage (file/sheet/row).

Re-runnable: truncates the silver tables first (bronze is the source of truth).
Connection via PG* env vars or DATABASE_URL.
"""
import os, re, sys, datetime
import psycopg2
from psycopg2.extras import execute_values, Json
from dateutil import parser as dtparser

BATCH = 2000

# --------------------------------------------------------------------------- #
# header normalization + value coercion
# --------------------------------------------------------------------------- #
def norm(h):
    return re.sub(r"[^a-z0-9]+", " ", str(h).lower()).strip() if h is not None else ""

def s(v):
    if v is None: return None
    v = str(v).strip()
    return v or None

def num(v):
    if v is None: return None
    t = str(v).replace(",", "").strip().rstrip("%")
    if t in ("", "-", "n/a", "na", "none"): return None
    try: return float(t)
    except ValueError: return None

def intval(v):
    f = num(v)
    return int(f) if f is not None else None

TRUE = {"true", "t", "yes", "y", "1", "settled", "void", "done", "success"}
FALSE = {"false", "f", "no", "n", "0"}
def boolean(v):
    if v is None: return None
    t = str(v).strip().lower()
    if t in TRUE: return True
    if t in FALSE: return False
    return None

def parse_dt(v):
    if v is None: return None
    t = str(v).strip()
    if not t: return None
    try:
        return dtparser.parse(t, dayfirst=False, fuzzy=True)
    except (ValueError, OverflowError, TypeError):
        try: return dtparser.parse(t, dayfirst=True, fuzzy=True)
        except Exception: return None

def to_date(v):
    d = parse_dt(v)
    return d.date() if d else None

def to_ts(v):
    return parse_dt(v)

# field name -> coercion type (field names are unique enough across entities)
FIELD_TYPE = {
 "recruited_date":"date","activation_date":"date","production_date":"date","opened_at":"date",
 "closed_at":"date","event_date":"date","as_of":"date","called_at":"date","replaced_at":"date",
 "period_start":"date","period_end":"date",
 "first_report":"ts","last_access_time":"ts","snapshot_at":"ts","created_at":"ts","settled_at":"ts",
 "battery_level":"num","cpu_usage":"num","latitude":"num","longitude":"num","health_score":"num",
 "last_seen_hrs":"num","amount":"num","actual_amount":"num","total_transaction_amount":"num",
 "total_purchase_amount":"num","gateway_transaction_amount":"num","santimpay_commission":"num",
 "total_commission_br":"num","total_commission_cut":"num",
 "total_transaction_count":"int","total_purchase_count":"int","gateway_transaction_count":"int",
 "branch_count":"int",
 "settled":"bool","void":"bool",
}
def coerce(field, v):
    t = FIELD_TYPE.get(field)
    if t == "date": return to_date(v)
    if t == "ts":   return to_ts(v)
    if t == "num":  return num(v)
    if t == "int":  return intval(v)
    if t == "bool": return boolean(v)
    return s(v)

# --------------------------------------------------------------------------- #
# entity field maps: normalized source header -> canonical field
# fields starting with "_" are pseudo-fields handled in code (not DB columns)
# --------------------------------------------------------------------------- #
MERCHANTS = {
 "merchant id":"merchant_code","merchantid":"merchant_code","pos mercant id":"merchant_code",
 "pos merchant id":"merchant_code","mrc id":"merchant_code",
 "qr merchant id":"qr_merchant_id",
 "mrc trading registered name":"trading_name","merchant license name":"trading_name",
 "merchant licence name":"trading_name","trade name":"trading_name","merchant name":"trading_name",
 "trade nme":"trading_name",
 "business type":"business_type","category":"business_type",
 "owner name":"owner_name",
 "contact person":"contact_person","contacted person full name":"contact_person",
 "contact person full name":"contact_person",
 "merchant phone number":"phone","merchant phone number owner":"phone","phone":"phone",
 "phone number":"phone","merchant phone":"phone",
 "email address":"email","email":"email",
 "merchant license number":"license_number","merchant license":"license_number",
 "account number":"settlement_account","merchant settlemet bank account number":"settlement_account",
 "mrc account":"settlement_account","merchant bank account number":"settlement_account",
 "merchant bank account name":"settlement_account_name","account holder":"settlement_account_name",
 "address":"address","merchant address":"address","location":"address","merchant location":"address",
 "region":"region","city":"city","subcity":"subcity","sub city":"subcity","woreda":"woreda",
 "branch":"branch","branch name":"branch","how many branch have this merchant":"branch_count",
 "status conformation":"current_status","current status":"current_status","conformation":"current_status",
 "status":"current_status",
 "bank name":"_bank","bank":"_bank","account bank name":"_bank","merchant bank name":"_bank",
 "merchant settlemet bank name":"_bank",
 "full name santimpay employee":"_sales","santimpay employee full name":"_sales","sales name":"_sales",
 "recruited by":"_recruited",
}

DEVICES = {
 "pos serial number":"serial_number","serialnumber":"serial_number","serial number":"serial_number",
 "device serial number":"serial_number","serial":"serial_number",
 "terminal id":"terminal_id","terminalid":"terminal_id","pos terminal id":"terminal_id",
 "sales terminal id":"terminal_id",
 "psn":"psn","bankterminalid":"bank_terminal_id","bank terminal id":"bank_terminal_id",
 "devicetype":"device_type","device type":"device_type",
 "manufacturingmodel":"model","model":"model","manufacturing model":"model",
 "product":"manufacturer",
 "firmwareversion":"firmware_version","firmware version":"firmware_version",
 "hardwareversion":"hardware_version","pciversion":"pci_version","profileversion":"profile_version",
 "imei1":"imei1","imei2":"imei2",
 "production date":"production_date","date of production":"production_date",
 "first report":"first_report",
 "lastaccesstime":"last_access_time","last access time":"last_access_time",
 "last communication":"last_access_time",
 "status":"current_status",
 "merchant id":"_merchant_code","merchantid":"_merchant_code",
}

TELEMETRY = {
 "devicestatus":"device_status","device status":"device_status",
 "batterylevel":"battery_level","battery level":"battery_level",
 "connectivity":"connectivity","signal strength":"signal_strength",
 "lastaccesstime":"last_access_time","latest date":"last_access_time","last access time":"last_access_time",
 "cpu usage":"cpu_usage","available memory":"available_memory","available storage":"available_storage",
 "mobile data":"network_type","network type":"network_type","ip":"ip",
 "latitude":"latitude","longitude":"longitude",
 "createdat":"snapshot_at","created at":"snapshot_at","first report":"_first",
 "firmwareversion":"firmware_version",
 "serialnumber":"serial_number","pos serial number":"serial_number","serial":"serial_number",
 "terminalid":"terminal_id","terminal id":"terminal_id",
}

HEALTH = {
 "health score":"health_score","health bucket":"health_bucket","last seen hrs":"last_seen_hrs",
 "psn":"psn","battery level":"battery_level","signal strength":"signal_strength",
 "pos serial number":"serial_number","serialnumber":"serial_number",
}

SUMMARIES = {
 "terminal id":"terminal_id","terminalid":"terminal_id",
 "terminal name":"terminal_name","terminalname":"terminal_name",
 "merchant id":"merchant_external_id","merchantid":"merchant_external_id",
 "total transaction count":"total_transaction_count","totaltransactioncount":"total_transaction_count",
 "total transaction amount":"total_transaction_amount","totaltransactionamount":"total_transaction_amount",
 "total purchase count":"total_purchase_count","totalpurchasecount":"total_purchase_count",
 "total purchase amount":"total_purchase_amount","totalpurchaseamount":"total_purchase_amount",
 "gateway transaction count":"gateway_transaction_count","gatewaytransactioncount":"gateway_transaction_count",
 "gateway transaction amount":"gateway_transaction_amount","gatewaytransactionamount":"gateway_transaction_amount",
 "santimpay commission":"santimpay_commission","santimpaycommission":"santimpay_commission",
 "total commission br":"total_commission_br","totalcommissionbr":"total_commission_br",
 "totalcommissioncut":"total_commission_cut",
}

TRANSACTIONS = {
 "terminal id":"terminal_id","terminalid":"terminal_id","terminal name":"terminal_name",
 "terminalname":"terminal_name","merchantname":"_merchant_name",
 "bankmerchantid":"bank_merchant_id","bankterminalid":"bank_terminal_id",
 "amount":"amount","actual amount":"actual_amount",
 "transaction type":"transaction_type","transactiontype":"transaction_type",
 "payment via":"payment_via","pan number":"pan_number","pannumber":"pan_number",
 "account number":"account_number","accountnumber":"account_number",
 "invoice number":"invoice_number","invoicenumber":"invoice_number",
 "rrn":"rrn","stan":"stan","authid":"auth_id","auth id":"auth_id",
 "response code":"response_code","responsecode":"response_code",
 "status":"status","settled":"settled","void":"void",
 "created at":"created_at","createdat":"created_at","id":"external_id",
}

SETTLEMENTS = {
 "amount":"amount","date time":"settled_at","merchant":"merchant_ref",
 "response code":"response_code","rrn":"rrn","settled":"settled","stan":"stan",
 "status":"status","type":"txn_type","void":"void","terminal id":"terminal_id",
}

SIMS = {
 "simcard no":"sim_number","simcard number":"sim_number","sim card no":"sim_number","sim":"sim_number",
 "service number":"msisdn","msisdn":"msisdn","sim iccid":"iccid","iccid":"iccid",
 "sim type":"sim_type","service type":"service_type","customer name":"customer_name",
 "status name":"status",
}

TICKETS = {
 "ticket id":"ticket_code","user":"reported_by","issue":"issue","category":"category",
 "fix":"resolution","status":"status","date":"opened_at",
}

ASSIGN = {
 "deployment date":"event_date","date":"event_date","month":"_month",
 "received by person at marchant":"received_by","received by":"received_by","recived by":"received_by",
 "santimpay employee full name":"_performer","full name santimpay employee":"_performer",
 "location latitude longitude":"location","location":"location",
 "group id":"group_id","trello card url":"trello_card_url",
 "reason":"remark","remark":"remark","write comment":"remark","comment":"remark",
 "deployed pos photo must cover the area":"photo_url",
 "status":"condition",
 "device serial number":"serial_number","pos serial number":"serial_number","serial":"serial_number",
 "terminal id":"terminal_id","merchant license name":"_merchant_name","merchant id":"_merchant_code",
}

CALLF = {
 "name":"agent_name","merchant license name":"_merchant_name",
 "merchant phone number":"contact_phone","new contacted person phone number":"contact_phone",
 "device serial number":"device_serial","pos serial number":"device_serial",
 "comment":"comment","contacted person full name":"contacted_person",
 "call center follow first follow up":"follow_up_round","first follow up":"follow_up_round",
 "call center follow up":"follow_up_round",
}

ALL_MAPS = [MERCHANTS, DEVICES, TELEMETRY, HEALTH, SUMMARIES, TRANSACTIONS, SETTLEMENTS, SIMS,
            TICKETS, ASSIGN, CALLF]
GLOBAL_MAPPED = set().union(*ALL_MAPS)

# --------------------------------------------------------------------------- #
# row helpers
# --------------------------------------------------------------------------- #
def rownorm(data):
    """original header dict -> {normalized_header: value} (first non-empty wins)."""
    out = {}
    for k, v in data.items():
        nk = norm(k)
        if nk and (out.get(nk) in (None, "")) and v not in (None, ""):
            out[nk] = v
    return out

def build(rec_map, rn):
    """Apply a field map to a normalized row -> {canonical: rawvalue}."""
    rec = {}
    for nk, val in rn.items():
        f = rec_map.get(nk)
        if f and f not in rec and val not in (None, ""):
            rec[f] = val
    return rec

def attrs_of(data):
    return {k: v for k, v in data.items()
            if norm(k) not in GLOBAL_MAPPED and v not in (None, "")}

def clean_code(v):
    t = s(v)
    return t.rstrip("/").strip().upper() if t else None

# --------------------------------------------------------------------------- #
# qualification (which entities a sheet's rows feed)
# --------------------------------------------------------------------------- #
def has(rn, *keys): return any(k in rn for k in keys)

DEV_KEYS = ("pos serial number", "serialnumber", "serial number", "device serial number",
            "serial", "terminal id", "terminalid", "pos terminal id", "psn")

def qualifies(sig_set, fname=""):
    q = set()
    fl = fname.lower()
    if has(sig_set, "mrc trading registered name", "merchant license name", "merchant licence name",
           "trade name", "merchant name") or has(sig_set, "merchant id", "merchantid",
           "qr merchant id", "pos mercant id"):
        q.add("merchants")
    if has(sig_set, "pos serial number", "serialnumber", "serial number", "device serial number",
           "terminal id", "terminalid", "pos terminal id", "psn"):
        q.add("pos_devices")
    if has(sig_set, "batterylevel", "battery level", "devicestatus", "device status",
           "connectivity", "lastaccesstime", "signal strength", "cpu usage") and \
       has(sig_set, "serialnumber", "pos serial number", "serial", "terminalid", "terminal id", "psn"):
        q.add("device_telemetry")
    if has(sig_set, "health score", "health bucket"):
        q.add("device_health_scores")
    if has(sig_set, "simcard no", "simcard number", "service number", "sim iccid", "iccid"):
        q.add("sim_cards")
    if has(sig_set, "issue") and has(sig_set, "category"):
        q.add("tickets")
    # device lifecycle events (deploy / return / handover)
    if has(sig_set, *DEV_KEYS) and (
        has(sig_set, "deployment date", "received by person at marchant", "received by", "recived by")
        or re.search(r"deploy|assignment|activation|hand ?over|received pos", fl)
        or re.search(r"retur|returend|recived returned", fl)):
        q.add("device_assignments")
    # call-center follow-ups
    if has(sig_set, "call center follow first follow up", "contacted person full name",
           "new contacted person phone number") or \
       (re.search(r"follow|call center", fl) and has(sig_set, "comment", "device serial number")):
        q.add("call_followups")
    # financial family — pick at most one
    if has(sig_set, "total transaction count", "totaltransactioncount",
           "gateway transaction count", "gatewaytransactioncount", "totalcommissioncut"):
        q.add("transaction_summaries")
    elif has(sig_set, "settled") and has(sig_set, "merchant") and has(sig_set, "rrn") \
         and not has(sig_set, "terminal name", "terminalname", "pan number", "pannumber"):
        q.add("settlements")
    elif (has(sig_set, "rrn", "stan", "pan number", "pannumber", "invoice number", "invoicenumber",
              "authid") and has(sig_set, "amount", "actual amount")):
        q.add("transactions")
    return q

# --------------------------------------------------------------------------- #
# DB connection + caches
# --------------------------------------------------------------------------- #
def connect():
    if os.environ.get("DATABASE_URL"):
        return psycopg2.connect(os.environ["DATABASE_URL"])
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"),
        user=os.environ.get("PGUSER", "postgres"), password=os.environ.get("PGPASSWORD", "postgres"),
        dbname=os.environ.get("PGDATABASE", "appdb"))

bank_cache, emp_cache, merch_cache, dev_cache = {}, {}, {}, {}

# Canonicalize the many spellings of Ethiopian banks. Matched as substrings of
# the letters-only lowercased name; first hit wins.
BANK_CANON = [
 ("commercial bank", "Commercial Bank of Ethiopia"), ("cbe", "Commercial Bank of Ethiopia"),
 ("awash", "Awash Bank"),
 ("oromiya", "Oromia Bank"), ("oromia", "Oromia Bank"), ("romya", "Oromia Bank"),
 ("romiya", "Oromia Bank"),
 ("cooperative", "Cooperative Bank of Oromia"), ("coopbank", "Cooperative Bank of Oromia"),
 ("coop", "Cooperative Bank of Oromia"), ("cbo", "Cooperative Bank of Oromia"),
 ("abyssinia", "Bank of Abyssinia"), ("boa", "Bank of Abyssinia"),
 ("dashen", "Dashen Bank"), ("anbesa", "Lion Bank"), ("anbessa", "Lion Bank"),
 ("lion", "Lion Bank"), ("wegagen", "Wegagen Bank"),
 ("hibret", "Hibret Bank"), ("united", "Hibret Bank"),
 ("nib", "Nib Bank"), ("zemen", "Zemen Bank"), ("abay", "Abay Bank"),
 ("berhan", "Berhan Bank"), ("bunna", "Bunna Bank"), ("buna", "Bunna Bank"),
 ("zemzem", "ZamZam Bank"), ("enat", "Enat Bank"),
 ("ahadu", "Ahadu Bank"), ("amhara", "Amhara Bank"), ("hijra", "Hijra Bank"),
 ("sidama", "Sidama Bank"), ("shabelle", "Shabelle Bank"), ("zamzam", "ZamZam Bank"),
 ("tsedey", "Tsedey Bank"), ("tsehay", "Tsehay Bank"), ("goh", "Goh Betoch Bank"),
 ("siinqee", "Siinqee Bank"), ("sinqe", "Siinqee Bank"), ("gadaa", "Gadaa Bank"),
 ("gada", "Gadaa Bank"), ("geda", "Geda Bank"),
 ("global", "Global Bank"), ("addis", "Addis International Bank"),
 ("debub", "Debub Global Bank"), ("rammis", "Rammis Bank"),
]
def canon_bank(n):
    letters = re.sub(r"[^a-z]", "", n.lower())
    for needle, canon in BANK_CANON:
        # compare letters-only on both sides so multi-word needles match too
        if needle.replace(" ", "") in letters:
            return canon
    return n.strip()

def get_bank(cur, name):
    n = s(name)
    if not n: return None
    # Guard against misaligned sheets where a "Bank Name" column holds account
    # numbers / junk: a real bank name must contain letters and be >2 chars.
    letters = re.sub(r"[^a-z]", "", n.lower())
    if len(n) < 3 or len(letters) < 3:
        return None
    n = canon_bank(n)
    key = n.lower()
    if key in bank_cache: return bank_cache[key]
    cur.execute("SELECT id FROM spos.banks WHERE lower(name)=%s", (key,))
    r = cur.fetchone()
    if not r:
        cur.execute("INSERT INTO spos.banks(name) VALUES(%s) RETURNING id", (n,))
        r = cur.fetchone()
    bank_cache[key] = r[0]; return r[0]

def get_emp(cur, name, role=None):
    n = s(name)
    if not n: return None
    key = n.lower()
    if key in emp_cache: return emp_cache[key]
    cur.execute("SELECT id FROM spos.employees WHERE lower(full_name)=%s", (key,))
    r = cur.fetchone()
    if not r:
        cur.execute("INSERT INTO spos.employees(full_name,role) VALUES(%s,%s) RETURNING id", (n, role))
        r = cur.fetchone()
    emp_cache[key] = r[0]; return r[0]

MERCH_COLS = ["merchant_code","qr_merchant_id","trading_name","business_type","owner_name",
 "contact_person","phone","email","license_number","bank_id","settlement_account",
 "settlement_account_name","address","region","city","subcity","woreda","branch","branch_count",
 "current_status"]

def upsert_merchant(cur, rec, attrs, ref):
    code = clean_code(rec.get("merchant_code"))
    qr   = s(rec.get("qr_merchant_id"))
    name = s(rec.get("trading_name"))
    phone= s(rec.get("phone"))
    if not (code or qr or name): return None

    ck = ("c", code) if code else ("q", qr) if qr else ("n", (name or "").lower()+"|"+(phone or ""))
    if ck in merch_cache: return merch_cache[ck]

    bank_id = get_bank(cur, rec.pop("_bank", None))
    sales_id = get_emp(cur, rec.pop("_sales", None), "sales")
    rec.pop("_recruited", None)
    vals = {k: coerce(k, rec.get(k)) for k in MERCH_COLS}
    vals["merchant_code"] = code; vals["bank_id"] = bank_id; vals["sales_officer_id"] = sales_id
    cols = MERCH_COLS + ["sales_officer_id","attributes","source_ref"]
    data = [vals.get(c) for c in MERCH_COLS] + [sales_id, Json(attrs), Json(ref)]

    if code:
        setc = ", ".join(f"{c}=COALESCE(spos.merchants.{c}, EXCLUDED.{c})"
                         for c in cols if c not in ("attributes",))
        sql = (f"INSERT INTO spos.merchants ({', '.join(cols)}) VALUES ({', '.join(['%s']*len(cols))}) "
               f"ON CONFLICT (merchant_code) DO UPDATE SET {setc}, "
               f"attributes = spos.merchants.attributes || EXCLUDED.attributes, updated_at=now() "
               f"RETURNING id")
        cur.execute(sql, data)
    else:
        col = "qr_merchant_id" if qr else "trading_name"
        cur.execute(f"SELECT id FROM spos.merchants WHERE {col}=%s LIMIT 1", (qr or name,))
        r = cur.fetchone()
        if r:
            merch_cache[ck] = r[0]; return r[0]
        cur.execute(f"INSERT INTO spos.merchants ({', '.join(cols)}) "
                    f"VALUES ({', '.join(['%s']*len(cols))}) RETURNING id", data)
    mid = cur.fetchone()[0]; merch_cache[ck] = mid; return mid

DEV_COLS = ["serial_number","terminal_id","psn","bank_terminal_id","device_type","model",
 "manufacturer","firmware_version","hardware_version","pci_version","profile_version","imei1","imei2",
 "current_merchant_id","current_status","production_date","first_report","last_access_time"]

def upsert_device(cur, rec, merchant_id, attrs, ref):
    serial = s(rec.get("serial_number"))
    term   = s(rec.get("terminal_id"))
    psn    = s(rec.get("psn"))
    if not (serial or term or psn): return None
    dk = ("s", serial) if serial else ("t", term) if term else ("p", psn)
    if dk in dev_cache: return dev_cache[dk]

    vals = {k: coerce(k, rec.get(k)) for k in DEV_COLS}
    vals["serial_number"] = serial; vals["current_merchant_id"] = merchant_id
    data = [vals.get(c) for c in DEV_COLS] + [Json(attrs), Json(ref)]
    cols = DEV_COLS + ["attributes","source_ref"]

    if serial:
        setc = ", ".join(f"{c}=COALESCE(spos.pos_devices.{c}, EXCLUDED.{c})" for c in cols
                         if c != "attributes")
        cur.execute(
            f"INSERT INTO spos.pos_devices ({', '.join(cols)}) VALUES ({', '.join(['%s']*len(cols))}) "
            f"ON CONFLICT (serial_number) DO UPDATE SET {setc}, "
            f"attributes = spos.pos_devices.attributes || EXCLUDED.attributes, updated_at=now() "
            f"RETURNING id", data)
    else:
        col = "terminal_id" if term else "psn"
        cur.execute(f"SELECT id FROM spos.pos_devices WHERE {col}=%s LIMIT 1", (term or psn,))
        r = cur.fetchone()
        if r:
            dev_cache[dk] = r[0]; return r[0]
        cur.execute(f"INSERT INTO spos.pos_devices ({', '.join(cols)}) "
                    f"VALUES ({', '.join(['%s']*len(cols))}) RETURNING id", data)
    did = cur.fetchone()[0]; dev_cache[dk] = did; return did

# fact-table column orders
FACT = {
 "device_telemetry": ["device_id","serial_number","terminal_id","snapshot_at","snapshot_date",
   "device_status","connectivity","battery_level","signal_strength","cpu_usage","available_memory",
   "available_storage","network_type","ip","latitude","longitude","last_access_time","firmware_version",
   "attributes","source_ref"],
 "device_health_scores": ["device_id","serial_number","psn","as_of","health_score","health_bucket",
   "last_seen_hrs","battery_level","signal_strength","attributes","source_ref"],
 "transaction_summaries": ["period_start","period_end","terminal_id","terminal_name","merchant_id",
   "merchant_external_id","total_transaction_count","total_transaction_amount","total_purchase_count",
   "total_purchase_amount","gateway_transaction_count","gateway_transaction_amount",
   "santimpay_commission","total_commission_br","total_commission_cut","attributes","source_ref"],
 "transactions": ["external_id","terminal_id","terminal_name","merchant_id","bank_merchant_id",
   "bank_terminal_id","amount","actual_amount","transaction_type","payment_via","pan_number",
   "account_number","invoice_number","rrn","stan","auth_id","response_code","status","settled","void",
   "created_at","attributes","source_ref"],
 "settlements": ["merchant_id","merchant_ref","terminal_id","amount","settled","void","response_code",
   "rrn","stan","txn_type","status","settled_at","attributes","source_ref"],
 "sim_cards": ["sim_number","msisdn","iccid","sim_type","service_type","customer_name","status",
   "attributes","source_ref"],
 "tickets": ["ticket_code","merchant_id","device_id","reported_by","issue","category","resolution",
   "status","opened_at","attributes","source_ref"],
 "device_assignments": ["device_id","merchant_id","event_type","event_date","performed_by",
   "received_by","location","latitude","longitude","photo_url","condition","remark","group_id",
   "trello_card_url","attributes","source_ref"],
 "call_followups": ["merchant_id","device_serial","agent_name","contacted_person","contact_phone",
   "follow_up_round","outcome","comment","attributes","source_ref"],
}
buffers = {t: [] for t in FACT}
# tables with a natural unique key may see the same key across many source files
FLUSH_CONFLICT = {"sim_cards": "ON CONFLICT (sim_number) DO NOTHING"}

def flush(cur, table):
    if not buffers[table]: return
    cols = FACT[table]
    tail = FLUSH_CONFLICT.get(table, "")
    execute_values(cur, f"INSERT INTO spos.{table} ({', '.join(cols)}) VALUES %s {tail}",
                   buffers[table])
    buffers[table].clear()

def add_fact(cur, table, vals):
    buffers[table].append(tuple(vals.get(c) for c in FACT[table]))
    if len(buffers[table]) >= BATCH:
        flush(cur, table)

DOW_RE = re.compile(r"^(\d{1,2})(\d{2})(\d{4})$")
def period_from_sheet(name):
    """'1062025' / '10122025' -> a date (M D YYYY), best effort."""
    t = re.sub(r"\D", "", str(name or ""))
    if len(t) in (7, 8):
        try:
            if len(t) == 7:   # MDDYYYY or MMDYYYY ambiguous; assume M DD YYYY
                m, d, y = int(t[0]), int(t[1:3]), int(t[3:])
            else:
                m, d, y = int(t[0:2]), int(t[2:4]), int(t[4:])
            return datetime.date(y, m, d)
        except ValueError:
            return None
    return None

# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main():
    conn = connect(); conn.autocommit = False
    cur = conn.cursor()

    print("Truncating silver tables…")
    cur.execute("""TRUNCATE spos.tickets, spos.call_followups, spos.sim_cards, spos.settlements,
        spos.transactions, spos.transaction_summaries, spos.device_health_scores,
        spos.device_telemetry, spos.device_assignments, spos.bank_accounts, spos.pos_devices,
        spos.merchants, spos.employees, spos.banks RESTART IDENTITY CASCADE""")
    conn.commit()

    cur.execute("""SELECT s.id, s.sheet_name, s.header_signature, f.filename
                   FROM spos.source_sheets s JOIN spos.source_files f ON f.id=s.file_id
                   WHERE s.nrows > 0 ORDER BY s.nrows DESC""")
    sheets = cur.fetchall()
    print(f"Processing {len(sheets)} non-empty sheets…")

    read = conn.cursor()  # regular cursor: buffers each sheet's rows client-side
    counts = {}
    for sid, sname, sig, fname in sheets:
        sig_set = set(sig.split("|")) if sig else set()
        q = qualifies(sig_set, fname)
        if not q:
            continue
        is_return = bool(re.search(r"retur|recived returned|returend", fname.lower()))
        is_handover = bool(re.search(r"hand ?over|received pos|stock", fname.lower()))
        period = period_from_sheet(sname) or period_from_sheet(fname)

        read.execute("SELECT row_index, data FROM spos.raw_rows WHERE sheet_id=%s", (sid,))
        for row_index, data in read.fetchall():
            if True:
                rn = rownorm(data)
                ref = {"file": fname, "sheet": sname, "row": row_index}
                attrs = attrs_of(data)

                merchant_id = None
                if "merchants" in q:
                    merchant_id = upsert_merchant(cur, build(MERCHANTS, rn), attrs, ref)
                    counts["merchants"] = counts.get("merchants", 0) + (1 if merchant_id else 0)

                device_id = None
                if "pos_devices" in q:
                    drec = build(DEVICES, rn)
                    mlink = merchant_id
                    if mlink is None and drec.get("_merchant_code"):
                        mlink = upsert_merchant(cur, {"merchant_code": drec.get("_merchant_code")},
                                                {}, ref)
                    drec.pop("_merchant_code", None)
                    device_id = upsert_device(cur, drec, mlink, attrs, ref)
                    counts["pos_devices"] = counts.get("pos_devices", 0) + (1 if device_id else 0)

                if "device_telemetry" in q:
                    t = build(TELEMETRY, rn)
                    snap = coerce("snapshot_at", t.get("snapshot_at")) or \
                           coerce("last_access_time", t.get("last_access_time"))
                    add_fact(cur, "device_telemetry", {
                        "device_id": device_id, "serial_number": s(t.get("serial_number")),
                        "terminal_id": s(t.get("terminal_id")), "snapshot_at": snap,
                        "snapshot_date": snap.date() if snap else None,
                        "device_status": s(t.get("device_status")), "connectivity": s(t.get("connectivity")),
                        "battery_level": num(t.get("battery_level")),
                        "signal_strength": s(t.get("signal_strength")), "cpu_usage": num(t.get("cpu_usage")),
                        "available_memory": s(t.get("available_memory")),
                        "available_storage": s(t.get("available_storage")),
                        "network_type": s(t.get("network_type")), "ip": s(t.get("ip")),
                        "latitude": num(t.get("latitude")), "longitude": num(t.get("longitude")),
                        "last_access_time": coerce("last_access_time", t.get("last_access_time")),
                        "firmware_version": s(t.get("firmware_version")),
                        "attributes": Json(attrs), "source_ref": Json(ref)})
                    counts["device_telemetry"] = counts.get("device_telemetry", 0) + 1

                if "device_health_scores" in q:
                    h = build(HEALTH, rn)
                    add_fact(cur, "device_health_scores", {
                        "device_id": device_id, "serial_number": s(h.get("serial_number")),
                        "psn": s(h.get("psn")), "as_of": period,
                        "health_score": num(h.get("health_score")),
                        "health_bucket": s(h.get("health_bucket")),
                        "last_seen_hrs": num(h.get("last_seen_hrs")),
                        "battery_level": num(h.get("battery_level")),
                        "signal_strength": s(h.get("signal_strength")),
                        "attributes": Json(attrs), "source_ref": Json(ref)})
                    counts["device_health_scores"] = counts.get("device_health_scores", 0) + 1

                if "transaction_summaries" in q:
                    su = build(SUMMARIES, rn)
                    add_fact(cur, "transaction_summaries", {
                        "period_start": period, "period_end": period,
                        "terminal_id": s(su.get("terminal_id")), "terminal_name": s(su.get("terminal_name")),
                        "merchant_id": merchant_id, "merchant_external_id": s(su.get("merchant_external_id")),
                        "total_transaction_count": intval(su.get("total_transaction_count")),
                        "total_transaction_amount": num(su.get("total_transaction_amount")),
                        "total_purchase_count": intval(su.get("total_purchase_count")),
                        "total_purchase_amount": num(su.get("total_purchase_amount")),
                        "gateway_transaction_count": intval(su.get("gateway_transaction_count")),
                        "gateway_transaction_amount": num(su.get("gateway_transaction_amount")),
                        "santimpay_commission": num(su.get("santimpay_commission")),
                        "total_commission_br": num(su.get("total_commission_br")),
                        "total_commission_cut": num(su.get("total_commission_cut")),
                        "attributes": Json(attrs), "source_ref": Json(ref)})
                    counts["transaction_summaries"] = counts.get("transaction_summaries", 0) + 1

                if "transactions" in q:
                    tx = build(TRANSACTIONS, rn); tx.pop("_merchant_name", None)
                    add_fact(cur, "transactions", {
                        "external_id": s(tx.get("external_id")), "terminal_id": s(tx.get("terminal_id")),
                        "terminal_name": s(tx.get("terminal_name")), "merchant_id": merchant_id,
                        "bank_merchant_id": s(tx.get("bank_merchant_id")),
                        "bank_terminal_id": s(tx.get("bank_terminal_id")),
                        "amount": num(tx.get("amount")), "actual_amount": num(tx.get("actual_amount")),
                        "transaction_type": s(tx.get("transaction_type")),
                        "payment_via": s(tx.get("payment_via")), "pan_number": s(tx.get("pan_number")),
                        "account_number": s(tx.get("account_number")),
                        "invoice_number": s(tx.get("invoice_number")), "rrn": s(tx.get("rrn")),
                        "stan": s(tx.get("stan")), "auth_id": s(tx.get("auth_id")),
                        "response_code": s(tx.get("response_code")), "status": s(tx.get("status")),
                        "settled": boolean(tx.get("settled")), "void": boolean(tx.get("void")),
                        "created_at": coerce("created_at", tx.get("created_at")),
                        "attributes": Json(attrs), "source_ref": Json(ref)})
                    counts["transactions"] = counts.get("transactions", 0) + 1

                if "settlements" in q:
                    se = build(SETTLEMENTS, rn)
                    add_fact(cur, "settlements", {
                        "merchant_id": merchant_id, "merchant_ref": s(se.get("merchant_ref")),
                        "terminal_id": s(se.get("terminal_id")), "amount": num(se.get("amount")),
                        "settled": boolean(se.get("settled")), "void": boolean(se.get("void")),
                        "response_code": s(se.get("response_code")), "rrn": s(se.get("rrn")),
                        "stan": s(se.get("stan")), "txn_type": s(se.get("txn_type")),
                        "status": s(se.get("status")), "settled_at": coerce("settled_at", se.get("settled_at")),
                        "attributes": Json(attrs), "source_ref": Json(ref)})
                    counts["settlements"] = counts.get("settlements", 0) + 1

                if "sim_cards" in q:
                    si = build(SIMS, rn)
                    if s(si.get("sim_number")) or s(si.get("msisdn")) or s(si.get("iccid")):
                        add_fact(cur, "sim_cards", {
                            "sim_number": s(si.get("sim_number")), "msisdn": s(si.get("msisdn")),
                            "iccid": s(si.get("iccid")), "sim_type": s(si.get("sim_type")),
                            "service_type": s(si.get("service_type")),
                            "customer_name": s(si.get("customer_name")), "status": s(si.get("status")),
                            "attributes": Json(attrs), "source_ref": Json(ref)})
                        counts["sim_cards"] = counts.get("sim_cards", 0) + 1

                if "tickets" in q:
                    tk = build(TICKETS, rn)
                    add_fact(cur, "tickets", {
                        "ticket_code": s(tk.get("ticket_code")), "merchant_id": merchant_id,
                        "device_id": device_id, "reported_by": s(tk.get("reported_by")),
                        "issue": s(tk.get("issue")), "category": s(tk.get("category")),
                        "resolution": s(tk.get("resolution")), "status": s(tk.get("status")),
                        "opened_at": to_date(tk.get("opened_at")),
                        "attributes": Json(attrs), "source_ref": Json(ref)})
                    counts["tickets"] = counts.get("tickets", 0) + 1

                if "device_assignments" in q:
                    a = build(ASSIGN, rn)
                    if device_id or s(a.get("serial_number")) or s(a.get("terminal_id")):
                        etype = "return" if is_return else "handover" if is_handover else "deploy"
                        add_fact(cur, "device_assignments", {
                            "device_id": device_id, "merchant_id": merchant_id, "event_type": etype,
                            "event_date": to_date(a.get("event_date")),
                            "performed_by": get_emp(cur, a.get("_performer"), "deployment"),
                            "received_by": s(a.get("received_by")), "location": s(a.get("location")),
                            "latitude": None, "longitude": None, "photo_url": s(a.get("photo_url")),
                            "condition": s(a.get("condition")), "remark": s(a.get("remark")),
                            "group_id": s(a.get("group_id")),
                            "trello_card_url": s(a.get("trello_card_url")),
                            "attributes": Json(attrs), "source_ref": Json(ref)})
                        counts["device_assignments"] = counts.get("device_assignments", 0) + 1

                if "call_followups" in q:
                    cf = build(CALLF, rn)
                    if s(cf.get("agent_name")) or s(cf.get("device_serial")) or s(cf.get("comment")):
                        add_fact(cur, "call_followups", {
                            "merchant_id": merchant_id, "device_serial": s(cf.get("device_serial")),
                            "agent_name": s(cf.get("agent_name")),
                            "contacted_person": s(cf.get("contacted_person")),
                            "contact_phone": s(cf.get("contact_phone")),
                            "follow_up_round": s(cf.get("follow_up_round")), "outcome": None,
                            "comment": s(cf.get("comment")),
                            "attributes": Json(attrs), "source_ref": Json(ref)})
                        counts["call_followups"] = counts.get("call_followups", 0) + 1
        for t in FACT:
            flush(cur, t)
        conn.commit()

    read.close(); cur.close(); conn.close()
    print("\n=== silver load complete ===")
    for k in sorted(counts):
        print(f"  {k:24s} {counts[k]}")

if __name__ == "__main__":
    main()
