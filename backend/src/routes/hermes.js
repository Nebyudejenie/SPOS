import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../config/db.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// "Hermes" — natural-language Q&A over the SPOS warehouse (idea.md's analyst).
// Claude (Opus 4.8) plans and calls a single, sandboxed read-only SQL tool.
const router = Router();

const MODEL = 'claude-opus-4-8';
const MAX_TURNS = 6;

// Schema the model is allowed to reason about. Kept stable (cache-friendly) and
// steers Claude toward the curated gold views.
const SCHEMA_DOC = `
You are Hermes, a data analyst for SPOS — a Smart-POS merchant/device operation in Ethiopia.
All data lives in the PostgreSQL schema "spos". Money is in Ethiopian Birr.

Query it with the run_sql tool. Rules:
- Read-only: SELECT/WITH only. Always add a LIMIT (<= 200).
- Schema-qualify every table as spos.<name>. Prefer the gold VIEWS below.
- When you have the numbers, answer concisely with the figures; don't dump raw rows.

GOLD VIEWS (prefer these):
- spos.v_merchant_360(id, merchant_code, qr_merchant_id, trading_name, business_type, phone,
    bank_name, region, city, current_status, device_count, open_tickets,
    total_txn_amount, total_txn_count)
- spos.v_device_360(id, serial_number, terminal_id, model, merchant_name, current_status,
    last_seen_at, last_battery_level, last_connectivity, health_bucket, health_score)
- spos.v_pos_health(device_id, serial_number, terminal_id, current_merchant_id, health_bucket,
    health_score, last_seen_at, battery_level)
- spos.v_merchant_health(merchant_id, health_score, health_bucket, devices, bad_devices,
    txn_count, open_tickets, complaints, settlement_issues)

CORE TABLES:
- spos.merchants(id, merchant_code, qr_merchant_id, trading_name, business_type, phone, bank_id,
    settlement_account, region, city, subcity, woreda, current_status, ...)
- spos.banks(id, name)
- spos.pos_devices(id, serial_number, terminal_id, psn, model, current_merchant_id, current_status, ...)
- spos.device_telemetry(device_id, serial_number, snapshot_at, device_status, battery_level, connectivity, ...)
- spos.transaction_summaries(merchant_id, terminal_id, period_start, total_transaction_count,
    total_transaction_amount, santimpay_commission, total_commission_br, ...)
- spos.transactions(merchant_id, terminal_id, amount, transaction_type, status, created_at, ...)
- spos.settlements(merchant_id, amount, settled, void, settled_at, ...)
- spos.device_assignments(device_id, merchant_id, event_type, event_date, received_by, condition, ...)
- spos.call_followups(merchant_id, device_serial, agent_name, comment, ...)
- spos.sim_cards(sim_number, msisdn, iccid, status, ...)

YOUR PERSISTENT MEMORY (schema "hermes", read/write across sessions):
- Use the "recall" tool to look up things you learned before; "remember" to store durable
  facts, insights, glossary terms, or corrections; "log_event" to record significant findings.
- Store knowledge, NOT secrets — never put passwords, API keys, or tokens in memory.
- At the start of analysis, consider what you already remember; after finding something
  durable and reusable, remember it so future sessions benefit.
`;

const TOOLS = [
  {
    name: 'run_sql',
    description: 'Run a single read-only SQL SELECT/WITH query against the warehouse (spos.* or hermes.*) and return rows (max 200).',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A single read-only SQL statement.' } },
      required: ['query'],
    },
  },
  {
    name: 'recall',
    description: 'Read from your persistent memory (hermes.memory). Filter by kind/key or free-text search.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string' }, key: { type: 'string' },
        search: { type: 'string', description: 'free-text match on key/context/value' },
      },
    },
  },
  {
    name: 'remember',
    description: 'Store or update a durable fact/insight in persistent memory (upsert by kind+key). Never store secrets.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: "e.g. 'fact','insight','glossary','preference'" },
        key: { type: 'string' },
        value: { type: 'object', description: 'JSON value to remember' },
        context: { type: 'string' },
      },
      required: ['kind', 'key', 'value'],
    },
  },
  {
    name: 'log_event',
    description: 'Append a significant observation/action to the hermes.events log.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string' }, entity_id: { type: 'string' },
        action: { type: 'string' }, payload: { type: 'object' }, source: { type: 'string' },
      },
      required: ['entity_type', 'action'],
    },
  },
];

// Reject anything that isn't a single SELECT/WITH statement.
function isSafeSelect(sql) {
  const s = (sql || '').trim().replace(/;+\s*$/, '');
  if (!s) return false;
  if (s.includes(';')) return false;                       // no multiple statements
  if (!/^(select|with)\b/i.test(s)) return false;          // must read
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do)\b/i.test(s)) return false;
  return true;
}

// ---- Hermes memory (writes are confined to the hermes schema) --------------
export async function memRemember({ kind, key, value, context }) {
  if (!kind || !key) throw new Error('kind and key are required');
  const r = await pool.query(
    `INSERT INTO hermes.memory (kind, key, value, context) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (kind, key) DO UPDATE
         SET value = EXCLUDED.value, context = EXCLUDED.context
       RETURNING id`,
    [String(kind), String(key), JSON.stringify(value ?? {}), context ? String(context) : null]);
  return r.rows[0].id;
}

export async function memRecall({ kind, key, search, limit = 25 } = {}) {
  const where = [];
  const params = [];
  if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
  if (key) { params.push(key); where.push(`key = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(key ILIKE $${params.length} OR context ILIKE $${params.length} OR value::text ILIKE $${params.length})`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 25, 100));
  const r = await pool.query(
    `SELECT kind, key, value, context, updated_at FROM hermes.memory ${clause}
       ORDER BY updated_at DESC LIMIT $${params.length}`, params);
  return r.rows;
}

export async function logEvent({ entity_type, entity_id, action, payload, source }) {
  if (!entity_type || !action) throw new Error('entity_type and action are required');
  const r = await pool.query(
    `INSERT INTO hermes.events (entity_type, entity_id, action, payload, source)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [String(entity_type), entity_id ? String(entity_id) : null, String(action),
     payload ? JSON.stringify(payload) : null, source ? String(source) : 'hermes']);
  return r.rows[0].id;
}

// Execute inside a READ ONLY transaction with a statement timeout — defense in
// depth even if validation is bypassed: writes can't commit, slow queries abort.
export async function runReadOnlySql(sql) {
  if (!isSafeSelect(sql)) throw new Error('Only a single read-only SELECT/WITH query is allowed.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const res = await client.query(sql);
    return res.rows.slice(0, 200);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

router.post('/ask', asyncHandler(async (req, res) => {
  const question = (req.body?.question || '').toString().trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Hermes is not configured. Set ANTHROPIC_API_KEY on the backend to enable AI Q&A.',
    });
  }

  const client = new Anthropic();

  // Inject what Hermes already remembers so she starts informed (cross-session).
  let memoryDigest = '';
  try {
    const recent = await memRecall({ limit: 20 });
    if (recent.length) {
      memoryDigest = '\n\nWHAT YOU REMEMBER (most recent):\n' + recent
        .map((m) => `- [${m.kind}] ${m.key}: ${JSON.stringify(m.value).slice(0, 200)}`)
        .join('\n');
    }
  } catch { /* hermes schema may not exist yet — ignore */ }
  const system = SCHEMA_DOC + memoryDigest;

  const messages = [{ role: 'user', content: question }];
  const sqlRuns = [];
  const memoryWrites = [];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Request was declined.' });
    }

    // Preserve full content (incl. thinking blocks) for same-model continuation.
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) {
      const answer = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return res.json({ answer, sql: sqlRuns, memory: memoryWrites });
    }

    const toolResults = [];
    for (const tu of toolUses) {
      let content;
      let isError = false;
      try {
        if (tu.name === 'run_sql') {
          const q = tu.input?.query || '';
          const rows = await runReadOnlySql(q);
          sqlRuns.push({ query: q, rowCount: rows.length });
          content = JSON.stringify(rows).slice(0, 12000);
        } else if (tu.name === 'recall') {
          content = JSON.stringify(await memRecall(tu.input || {})).slice(0, 12000);
        } else if (tu.name === 'remember') {
          const id = await memRemember(tu.input || {});
          memoryWrites.push({ op: 'remember', kind: tu.input?.kind, key: tu.input?.key });
          content = `Remembered (id ${id}).`;
        } else if (tu.name === 'log_event') {
          const id = await logEvent(tu.input || {});
          memoryWrites.push({ op: 'log_event', entity: tu.input?.entity_type, action: tu.input?.action });
          content = `Logged (id ${id}).`;
        } else {
          isError = true; content = `Unknown tool: ${tu.name}`;
        }
      } catch (err) {
        isError = true; content = `Error: ${err.message}`;
        if (tu.name === 'run_sql') sqlRuns.push({ query: tu.input?.query, error: err.message });
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  logger.warn('Hermes hit max turns', { question });
  return res.json({
    answer: "I couldn't complete the analysis within the step limit. Try a more specific question.",
    sql: sqlRuns, memory: memoryWrites,
  });
}));

// Inspect Hermes's persistent memory (read-only) — for transparency / a future UI.
router.get('/memory', asyncHandler(async (req, res) => {
  const rows = await memRecall({ kind: req.query.kind, search: req.query.search, limit: 100 });
  res.json({ data: rows, count: rows.length });
}));

export default router;
