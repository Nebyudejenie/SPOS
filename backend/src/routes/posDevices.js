import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import {
  createPosDevice as createRules,
  updatePosDevice as updateRules,
  idParam,
} from '../validators/posDeviceValidator.js';
import {
  listPosDevices,
  getPosDevice,
  createPosDevice,
  updatePosDevice,
  deletePosDevice,
} from '../controllers/posDeviceController.js';

const router = Router();

router.get('/', asyncHandler(listPosDevices));
router.get('/:id', idParam, validate, asyncHandler(getPosDevice));
router.post('/', createRules, validate, asyncHandler(createPosDevice));
router.put('/:id', updateRules, validate, asyncHandler(updatePosDevice));
router.delete('/:id', idParam, validate, asyncHandler(deletePosDevice));

export default router;
