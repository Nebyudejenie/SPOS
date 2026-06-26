import { query } from '../config/db.js';
import { ApiError } from '../middleware/errorHandler.js';

const WRITABLE = [
  'terminal_id', 'serial_number', 'model', 'merchant_id', 'merchant_name',
  'bank', 'sim_number', 'activation_date', 'last_communication', 'status',
  'transaction_volume', 'error_history', 'replacement_history', 'current_owner',
];

function pickWritable(body) {
  const out = {};
  for (const col of WRITABLE) {
    if (body[col] !== undefined) out[col] = body[col] === '' ? null : body[col];
  }
  return out;
}

export async function listPosDevices(req, res) {
  const { search, status, merchant_id } = req.query;
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(terminal_id ILIKE $${params.length} OR serial_number ILIKE $${params.length} OR model ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (merchant_id) {
    params.push(merchant_id);
    clauses.push(`merchant_id = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM pos_devices ${where} ORDER BY created_at DESC`,
    params,
  );
  res.json({ data: rows, count: rows.length });
}

export async function getPosDevice(req, res) {
  const { rows } = await query('SELECT * FROM pos_devices WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'POS device not found');
  res.json({ data: rows[0] });
}

export async function createPosDevice(req, res) {
  const data = pickWritable(req.body);
  const cols = Object.keys(data);
  if (cols.length === 0) throw new ApiError(400, 'No valid fields provided');

  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const values = cols.map((c) => data[c]);

  const { rows } = await query(
    `INSERT INTO pos_devices (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values,
  );
  res.status(201).json({ data: rows[0] });
}

export async function updatePosDevice(req, res) {
  const data = pickWritable(req.body);
  const cols = Object.keys(data);
  if (cols.length === 0) throw new ApiError(400, 'No valid fields to update');

  const assignments = cols.map((c, i) => `${c} = $${i + 1}`);
  const values = cols.map((c) => data[c]);
  values.push(req.params.id);

  const { rows } = await query(
    `UPDATE pos_devices SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (!rows[0]) throw new ApiError(404, 'POS device not found');
  res.json({ data: rows[0] });
}

export async function deletePosDevice(req, res) {
  const { rowCount } = await query('DELETE FROM pos_devices WHERE id = $1', [req.params.id]);
  if (rowCount === 0) throw new ApiError(404, 'POS device not found');
  res.status(204).send();
}
