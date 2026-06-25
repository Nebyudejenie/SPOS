import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Read-only API over the spos.* warehouse (gold views + silver tables).
const router = Router();

// Clamp pagination to sane bounds.
function page(req) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  return { limit, offset };
}

// ---------------------------------------------------------------------------
// Dashboard summary — the idea.md "generate insights automatically" view.
// ---------------------------------------------------------------------------
router.get('/summary', asyncHandler(async (req, res) => {
  const [counts, health, merchantHealth, banks, regions, topMerchants, txnByBank] = await Promise.all([
    query(`SELECT
              (SELECT count(*) FROM spos.merchants)             AS merchants,
              (SELECT count(*) FROM spos.pos_devices)           AS devices,
              (SELECT count(*) FROM spos.transactions)          AS transactions,
              (SELECT count(*) FROM spos.transaction_summaries) AS txn_summaries,
              (SELECT count(*) FROM spos.sim_cards)             AS sims,
              (SELECT count(*) FROM spos.banks)                 AS banks,
              (SELECT coalesce(sum(total_transaction_amount),0)
                 FROM spos.transaction_summaries)               AS total_txn_amount`),
    query(`SELECT health_bucket AS label, count(*)::int AS value
             FROM spos.v_pos_health GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT health_bucket AS label, count(*)::int AS value
             FROM spos.v_merchant_health GROUP BY 1
             ORDER BY array_position(ARRAY['Green','Yellow','Red'], health_bucket)`),
    query(`SELECT b.name AS label, count(m.id)::int AS value
             FROM spos.banks b JOIN spos.merchants m ON m.bank_id=b.id
             GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    query(`SELECT coalesce(nullif(region,''),'(unknown)') AS label, count(*)::int AS value
             FROM spos.merchants GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    query(`SELECT id, coalesce(trading_name, merchant_code, '(unnamed)') AS name,
                  device_count::int, total_txn_amount::numeric AS txn_amount
             FROM spos.v_merchant_360
             WHERE total_txn_amount > 0 ORDER BY total_txn_amount DESC LIMIT 10`),
    query(`SELECT coalesce(b.name,'(unassigned)') AS label,
                  coalesce(sum(s.total_transaction_amount),0)::numeric AS value
             FROM spos.transaction_summaries s
             LEFT JOIN spos.merchants m ON m.id=s.merchant_id
             LEFT JOIN spos.banks b ON b.id=m.bank_id
             GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
  ]);

  res.json({
    counts: counts.rows[0],
    health: health.rows,
    merchantHealth: merchantHealth.rows,
    banks: banks.rows,
    regions: regions.rows,
    topMerchants: topMerchants.rows,
    txnByBank: txnByBank.rows,
  });
}));

// ---------------------------------------------------------------------------
// Merchants (from v_merchant_360)
// ---------------------------------------------------------------------------
router.get('/merchants', asyncHandler(async (req, res) => {
  const { limit, offset } = page(req);
  const { search, bank, status } = req.query;
  const where = [];
  const params = [];

  // Columns are qualified with v. so the health LEFT JOIN below is unambiguous.
  if (search) {
    params.push(`%${search}%`);
    where.push(`(v.trading_name ILIKE $${params.length} OR v.merchant_code ILIKE $${params.length}
                 OR v.qr_merchant_id ILIKE $${params.length} OR v.phone ILIKE $${params.length})`);
  }
  if (bank) { params.push(bank); where.push(`v.bank_name = $${params.length}`); }
  if (status) { params.push(status); where.push(`v.current_status = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await query(
    `SELECT count(*)::int AS n FROM spos.v_merchant_360 v ${clause}`, params);
  params.push(limit, offset);
  const rows = await query(
    `SELECT v.id, v.merchant_code, v.qr_merchant_id, v.trading_name, v.business_type, v.phone,
            v.bank_name, v.region, v.city, v.current_status, v.device_count::int,
            v.open_tickets::int, v.total_txn_amount::numeric, v.total_txn_count::bigint,
            h.health_score::int, h.health_bucket
       FROM spos.v_merchant_360 v
       LEFT JOIN spos.v_merchant_health h ON h.merchant_id = v.id
       ${clause}
       ORDER BY v.total_txn_amount DESC NULLS LAST, v.trading_name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({ data: rows.rows, total: total.rows[0].n, limit, offset });
}));

router.get('/merchants/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const m = await query(
    `SELECT v.*, h.health_score::int, h.health_bucket, h.devices AS h_devices,
            h.bad_devices, h.complaints, h.settlement_issues
       FROM spos.v_merchant_360 v
       LEFT JOIN spos.v_merchant_health h ON h.merchant_id = v.id
       WHERE v.id = $1`, [id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Merchant not found' });

  const [devices, accounts, tickets, summaries, deployments, followups] = await Promise.all([
    query(`SELECT id, serial_number, terminal_id, model, current_status,
                  last_seen_at, health_bucket
             FROM spos.v_device_360 WHERE current_merchant_id = $1
             ORDER BY last_seen_at DESC NULLS LAST`, [id]),
    query(`SELECT account_number, account_holder, is_current,
                  (SELECT name FROM spos.banks b WHERE b.id = ba.bank_id) AS bank
             FROM spos.bank_accounts ba WHERE merchant_id = $1`, [id]),
    query(`SELECT id, issue, category, status, opened_at FROM spos.tickets
             WHERE merchant_id = $1 ORDER BY opened_at DESC NULLS LAST LIMIT 50`, [id]),
    query(`SELECT period_start, terminal_id, total_transaction_count,
                  total_transaction_amount, santimpay_commission
             FROM spos.transaction_summaries WHERE merchant_id = $1
             ORDER BY total_transaction_amount DESC NULLS LAST LIMIT 50`, [id]),
    query(`SELECT event_type, event_date, received_by, condition, remark
             FROM spos.device_assignments WHERE merchant_id = $1
             ORDER BY event_date DESC NULLS LAST LIMIT 50`, [id]),
    query(`SELECT agent_name, contacted_person, contact_phone, follow_up_round, comment
             FROM spos.call_followups WHERE merchant_id = $1 LIMIT 50`, [id]),
  ]);

  res.json({
    merchant: m.rows[0],
    devices: devices.rows,
    accounts: accounts.rows,
    tickets: tickets.rows,
    summaries: summaries.rows,
    deployments: deployments.rows,
    followups: followups.rows,
  });
}));

// ---------------------------------------------------------------------------
// Devices (from v_device_360)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Knowledge graph — a merchant's ego network (idea.md: connect, don't isolate).
// ---------------------------------------------------------------------------
router.get('/graph/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const m = await query(
    `SELECT id, coalesce(trading_name, merchant_code, '(merchant)') AS name,
            bank_id, sales_officer_id FROM spos.merchants WHERE id = $1`, [id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Merchant not found' });
  const merchant = m.rows[0];

  const [bank, officer, devices, tickets, txn] = await Promise.all([
    merchant.bank_id
      ? query('SELECT id, name FROM spos.banks WHERE id = $1', [merchant.bank_id]) : { rows: [] },
    merchant.sales_officer_id
      ? query('SELECT id, full_name FROM spos.employees WHERE id = $1', [merchant.sales_officer_id])
      : { rows: [] },
    query(`SELECT id, coalesce(serial_number, terminal_id, '(device)') AS label, health_bucket
             FROM spos.v_device_360 WHERE current_merchant_id = $1 LIMIT 14`, [id]),
    query(`SELECT id, coalesce(issue, category, 'ticket') AS label FROM spos.tickets
             WHERE merchant_id = $1 LIMIT 6`, [id]),
    query(`SELECT coalesce(sum(total_transaction_count),0)::bigint AS c,
                  coalesce(sum(total_transaction_amount),0)::numeric AS a
             FROM spos.transaction_summaries WHERE merchant_id = $1`, [id]),
  ]);

  const nodes = [{ id: `m:${merchant.id}`, type: 'merchant', label: merchant.name }];
  const edges = [];
  if (bank.rows[0]) {
    nodes.push({ id: `b:${bank.rows[0].id}`, type: 'bank', label: bank.rows[0].name });
    edges.push({ source: `m:${merchant.id}`, target: `b:${bank.rows[0].id}`, rel: 'settles_with' });
  }
  if (officer.rows[0]) {
    nodes.push({ id: `e:${officer.rows[0].id}`, type: 'officer', label: officer.rows[0].full_name });
    edges.push({ source: `m:${merchant.id}`, target: `e:${officer.rows[0].id}`, rel: 'sold_by' });
  }
  for (const d of devices.rows) {
    nodes.push({ id: `d:${d.id}`, type: 'device', label: d.label, health: d.health_bucket });
    edges.push({ source: `m:${merchant.id}`, target: `d:${d.id}`, rel: 'operates' });
  }
  for (const t of tickets.rows) {
    nodes.push({ id: `t:${t.id}`, type: 'ticket', label: t.label });
    edges.push({ source: `m:${merchant.id}`, target: `t:${t.id}`, rel: 'raised' });
  }
  if (Number(txn.rows[0].c) > 0) {
    nodes.push({ id: `x:${merchant.id}`, type: 'transactions',
      label: `${Number(txn.rows[0].c).toLocaleString()} txns` });
    edges.push({ source: `m:${merchant.id}`, target: `x:${merchant.id}`, rel: 'transacted' });
  }

  res.json({ nodes, edges });
}));

router.get('/devices', asyncHandler(async (req, res) => {
  const { limit, offset } = page(req);
  const { search, status, health } = req.query;
  const where = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(serial_number ILIKE $${params.length} OR terminal_id ILIKE $${params.length}
                 OR merchant_name ILIKE $${params.length} OR model ILIKE $${params.length})`);
  }
  if (status) { params.push(status); where.push(`current_status = $${params.length}`); }
  if (health) { params.push(health); where.push(`health_bucket = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await query(`SELECT count(*)::int AS n FROM spos.v_device_360 ${clause}`, params);
  params.push(limit, offset);
  const rows = await query(
    `SELECT id, serial_number, terminal_id, model, merchant_name, current_status,
            last_seen_at, last_battery_level, last_connectivity, health_bucket, health_score
       FROM spos.v_device_360 ${clause}
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({ data: rows.rows, total: total.rows[0].n, limit, offset });
}));

router.get('/devices/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const d = await query('SELECT * FROM spos.v_device_360 WHERE id = $1', [id]);
  if (!d.rows[0]) return res.status(404).json({ error: 'Device not found' });

  const telemetry = await query(
    `SELECT snapshot_at, device_status, battery_level, connectivity, signal_strength,
            latitude, longitude
       FROM spos.device_telemetry WHERE device_id = $1
       ORDER BY snapshot_at DESC NULLS LAST LIMIT 100`, [id]);

  res.json({ device: d.rows[0], telemetry: telemetry.rows });
}));

export default router;
