#!/usr/bin/env python3
"""
Phase 4 — Merchant dedup (conservative, re-runnable).

Name-only merchants (no merchant_code) are frequently the same business that also
appears as a coded record, or repeat across sheets. This collapses them:

  * a name-only merchant whose normalized name matches EXACTLY ONE coded merchant
    is merged into that coded merchant;
  * name-only merchants that share (normalized name + last-9-phone-digits) are
    merged together (survivor = the one with the most linked rows).

Coded merchants are authoritative and never merged into each other. Before any
delete, every child row (devices, txns, summaries, settlements, accounts, tickets,
follow-ups, assignments) is re-pointed to the survivor. Idempotent.

Connection via PG* env vars or DATABASE_URL.
"""
import os, re, sys
import psycopg2

MIN_NAME_LEN = 5  # don't absorb on very short/generic names

CHILD_FKS = [  # (table, column)
    ("pos_devices", "current_merchant_id"),
    ("bank_accounts", "merchant_id"),
    ("transactions", "merchant_id"),
    ("transaction_summaries", "merchant_id"),
    ("settlements", "merchant_id"),
    ("tickets", "merchant_id"),
    ("call_followups", "merchant_id"),
    ("device_assignments", "merchant_id"),
]

def connect():
    if os.environ.get("DATABASE_URL"):
        return psycopg2.connect(os.environ["DATABASE_URL"])
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"), port=os.environ.get("PGPORT", "5432"),
        user=os.environ.get("PGUSER", "postgres"), password=os.environ.get("PGPASSWORD", "postgres"),
        dbname=os.environ.get("PGDATABASE", "appdb"))

def normname(n):
    if not n: return ""
    return re.sub(r"[^a-z0-9]+", " ", n.lower()).strip()

def phone9(p):
    if not p: return ""
    d = re.sub(r"\D", "", str(p))
    return d[-9:] if len(d) >= 9 else ""

# --- union-find ---
parent = {}
def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[ra] = rb

def main():
    apply = "--apply" in sys.argv
    conn = connect(); conn.autocommit = False
    cur = conn.cursor()

    cur.execute("""SELECT id, merchant_code, qr_merchant_id, trading_name, phone
                   FROM spos.merchants""")
    rows = cur.fetchall()
    coded, named = [], []
    for mid, code, qr, name, phone in rows:
        rec = {"id": mid, "code": code, "name": normname(name), "phone": phone9(phone)}
        (coded if code else named).append(rec)

    # coded merchants indexed by normalized name (only names that are unambiguous)
    coded_by_name = {}
    for r in coded:
        if r["name"]:
            coded_by_name.setdefault(r["name"], []).append(r["id"])

    # edges
    name_phone_groups = {}
    absorb = 0
    for r in named:
        n = r["name"]
        if n and len(n) >= MIN_NAME_LEN and len(coded_by_name.get(n, [])) == 1:
            union(r["id"], coded_by_name[n][0]); absorb += 1
        if n and r["phone"]:
            name_phone_groups.setdefault((n, r["phone"]), []).append(r["id"])
    for ids in name_phone_groups.values():
        for other in ids[1:]:
            union(ids[0], other)

    # build clusters of >1
    coded_ids = {r["id"] for r in coded}
    clusters = {}
    for r in rows:
        mid = r[0]
        if mid in parent:
            clusters.setdefault(find(mid), set()).add(mid)
    clusters = {root: members for root, members in clusters.items() if len(members) > 1}

    # link counts to pick survivor among name-only-only clusters
    def link_count(mid):
        total = 0
        for tbl, col in CHILD_FKS:
            cur.execute(f"SELECT count(*) FROM spos.{tbl} WHERE {col}=%s", (mid,))
            total += cur.fetchone()[0]
        return total

    merged_rows = merged_into = 0
    for members in clusters.values():
        coded_members = [m for m in members if m in coded_ids]
        if len(coded_members) > 1:
            continue  # ambiguous — never merge distinct coded merchants
        if coded_members:
            survivor = coded_members[0]
        else:
            survivor = max(members, key=link_count)
        losers = [m for m in members if m != survivor]
        if not losers: continue
        merged_into += 1; merged_rows += len(losers)
        if apply:
            for loser in losers:
                for tbl, col in CHILD_FKS:
                    cur.execute(f"UPDATE spos.{tbl} SET {col}=%s WHERE {col}=%s", (survivor, loser))
                # fill survivor's NULL fields from the loser; merge attributes
                cur.execute("""
                    UPDATE spos.merchants s SET
                      qr_merchant_id      = COALESCE(s.qr_merchant_id, l.qr_merchant_id),
                      trading_name        = COALESCE(s.trading_name, l.trading_name),
                      business_type       = COALESCE(s.business_type, l.business_type),
                      phone               = COALESCE(s.phone, l.phone),
                      bank_id             = COALESCE(s.bank_id, l.bank_id),
                      settlement_account  = COALESCE(s.settlement_account, l.settlement_account),
                      address             = COALESCE(s.address, l.address),
                      region              = COALESCE(s.region, l.region),
                      city                = COALESCE(s.city, l.city),
                      attributes          = l.attributes || s.attributes
                    FROM spos.merchants l WHERE s.id=%s AND l.id=%s""", (survivor, loser))
                cur.execute("DELETE FROM spos.merchants WHERE id=%s", (loser,))
            conn.commit()

    print(f"clusters with duplicates : {len(clusters)}")
    print(f"name-only absorbed into coded (edges): {absorb}")
    print(f"survivors that gained rows: {merged_into}")
    print(f"duplicate merchants {'merged' if apply else 'that WOULD merge'}: {merged_rows}")
    if not apply:
        print("\n(dry run — re-run with --apply to perform the merge)")

    cur.close(); conn.close()

if __name__ == "__main__":
    main()
