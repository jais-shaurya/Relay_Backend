import { Router } from 'express';

import {
  getRuntimes,
  getRuntime,
} from '../controller/runtime.controller.js';

const router = Router();

router.get('/', getRuntimes);
router.get('/:runtimeId', getRuntime);

export default router;