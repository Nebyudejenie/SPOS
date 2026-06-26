import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import {
  createMerchant as createRules,
  updateMerchant as updateRules,
  idParam,
} from '../validators/merchantValidator.js';
import {
  listMerchants,
  getMerchant,
  createMerchant,
  updateMerchant,
  deleteMerchant,
} from '../controllers/merchantController.js';

const router = Router();

router.get('/', asyncHandler(listMerchants));
router.get('/:id', idParam, validate, asyncHandler(getMerchant));
router.post('/', createRules, validate, asyncHandler(createMerchant));
router.put('/:id', updateRules, validate, asyncHandler(updateMerchant));
router.delete('/:id', idParam, validate, asyncHandler(deleteMerchant));

export default router;
