import { validationResult } from 'express-validator';

// Runs after express-validator chains; rejects with a 422 + field details.
export function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  return res.status(422).json({
    error: 'Validation failed',
    details: result.array().map((e) => ({ field: e.path, message: e.msg })),
  });
}
