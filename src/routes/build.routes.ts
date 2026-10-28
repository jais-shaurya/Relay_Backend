import { Router } from 'express';

import {
  getBuild,
  getBuildLogs,
} from '../controller/build.controller.js';

const router = Router();

router.get('/:buildNumber/logs', getBuildLogs);
router.get('/:buildNumber', getBuild);

export default router;