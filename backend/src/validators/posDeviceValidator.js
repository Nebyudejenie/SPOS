import { body, param } from 'express-validator';

const STATUS = ['active', 'inactive', 'faulty'];

const optionalFields = [
  body('serial_number').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('model').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('merchant_id').optional({ nullable: true }).isUUID().withMessage('merchant_id must be a valid UUID'),
  body('merchant_name').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body('bank').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
  body('sim_number').optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
  body('activation_date').optional({ nullable: true }).isISO8601().withMessage('must be a valid date (YYYY-MM-DD)'),
  body('last_communication').optional({ nullable: true }).isISO8601().withMessage('must be a valid timestamp'),
  body('status').optional({ nullable: true }).isIn(STATUS).withMessage(`must be one of: ${STATUS.join(', ')}`),
  body('transaction_volume').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('must be a number >= 0'),
  body('error_history').optional({ nullable: true }).isString(),
  body('replacement_history').optional({ nullable: true }).isString(),
  body('current_owner').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
];

export const idParam = [param('id').isUUID().withMessage('id must be a valid UUID')];

export const createPosDevice = [
  body('terminal_id').isString().trim().notEmpty().withMessage('terminal_id is required').isLength({ max: 64 }),
  ...optionalFields,
];

export const updatePosDevice = [
  ...idParam,
  body('terminal_id').optional().isString().trim().notEmpty().isLength({ max: 64 }),
  ...optionalFields,
];
