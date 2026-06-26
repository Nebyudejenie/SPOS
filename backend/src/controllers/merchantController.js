import { query } from '../config/db.js';
import { ApiError } from '../middleware/errorHandler.js';

// Columns a client is allowed to write. Order is preserved for INSERT/UPDATE.
const WRITABLE = [
  'merchant_code', 'merchant_name', 'business_type', 'owner_name', 'phone_number',
  'address', 'region', 'sales_officer', 'activation_officer', 'account_manager',
  'assigned_pos', 'bank', 'settlement_account', 'qr_status', 'pos_status',
  'activation_date', 'last_transaction_date', 'monthly_volume', 'support_history',
  'current_status', 'notes',
];

function pickWritable(body) {
  const out = {};
  for (const col of WRITABLE) {
    if (body[col] !== undefined) out[col] = body[col] === '' ? null : body[col];
  }
  return out;
}

export async function listMerchants(req, res) {
  const { search, region, status } = req.query;
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(merchant_name ILIKE $${params.length} OR merchant_code ILIKE $${params.length})`);
  }
  if (region) {
    params.push(region);
    clauses.push(`region = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`current_status = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM merchants ${where} ORDER BY created_at DESC`,
    params,
  );
  res.json({ data: rows, count: rows.length });
}

export async function getMerchant(req, res) {
  const { rows } = await query('SELECT * FROM merchants WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Merchant not found');
  res.json({ data: rows[0] });
}

export async function createMerchant(req, res) {
  const data = pickWritable(req.body);
  const cols = Object.keys(data);
  if (cols.length === 0) throw new ApiError(400, 'No valid fields provided');

  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const values = cols.map((c) => data[c]);

  const { rows } = await query(
    `INSERT INTO merchants (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values,
  );
  res.status(201).json({ data: rows[0] });
}

export async function updateMerchant(req, res) {
  const data = pickWritable(req.body);
  const cols = Object.keys(data);
  if (cols.length === 0) throw new ApiError(400, 'No valid fields to update');

  const assignments = cols.map((c, i) => `${c} = $${i + 1}`);
  const values = cols.map((c) => data[c]);
  values.push(req.params.id);

  const { rows } = await query(
    `UPDATE merchants SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (!rows[0]) throw new ApiError(404, 'Merchant not found');
  res.json({ data: rows[0] });
}

export async function deleteMerchant(req, res) {
  const { rowCount } = await query('DELETE FROM merchants WHERE id = $1', [req.params.id]);
  if (rowCount === 0) throw new ApiError(404, 'Merchant not found');
  res.status(204).send();
}
