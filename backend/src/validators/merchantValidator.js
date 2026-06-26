import { body, param } from 'express-validator';

const STATUS = ['active', 'inactive', 'suspended'];
const TOGGLE = ['active', 'inactive'];

// Shared optional fields for both create and update.
const optionalFields = [
  body('business_type').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('owner_name').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
  body('phone_number').optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
  body('address').optional({ nullable: true }).isString().trim(),
  body('region').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('sales_officer').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
  body('activation_officer').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
  body('account_manager').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
  body('assigned_pos').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('bank').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
  body('settlement_account').optional({ nullable: true }).isString().trim().isLength({ max: 64 }),
  body('qr_status').optional({ nullable: true }).isIn(TOGGLE).withMessage(`must be one of: ${TOGGLE.join(', ')}`),
  body('pos_status').optional({ nullable: true }).isIn(TOGGLE).withMessage(`must be one of: ${TOGGLE.join(', ')}`),
  body('activation_date').optional({ nullable: true }).isISO8601().withMessage('must be a valid date (YYYY-MM-DD)'),
  body('last_transaction_date').optional({ nullable: true }).isISO8601().withMessage('must be a valid date (YYYY-MM-DD)'),
  body('monthly_volume').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('must be a number >= 0'),
  body('support_history').optional({ nullable: true }).isString(),
  body('current_status').optional({ nullable: true }).isIn(STATUS).withMessage(`must be one of: ${STATUS.join(', ')}`),
  body('notes').optional({ nullable: true }).isString(),
];

export const idParam = [param('id').isUUID().withMessage('id must be a valid UUID')];

export const createMerchant = [
  body('merchant_code').isString().trim().notEmpty().withMessage('merchant_code is required').isLength({ max: 32 }),
  body('merchant_name').isString().trim().notEmpty().withMessage('merchant_name is required').isLength({ max: 255 }),
  ...optionalFields,
];

export const updateMerchant = [
  ...idParam,
  body('merchant_code').optional().isString().trim().notEmpty().isLength({ max: 32 }),
  body('merchant_name').optional().isString().trim().notEmpty().isLength({ max: 255 }),
  ...optionalFields,
];
