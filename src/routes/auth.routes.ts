import { Router } from 'express';

import { createOrLoginUser } from '../controller/auth.controller.js';
import { verifyFirebaseToken } from '../middleware/firebase.js';

const router = Router();

// Initialize or retrieve the profile after Firebase signup/login.
// The controller can create the profile if it doesn't exist.
router.post('/', verifyFirebaseToken, createOrLoginUser);

export default router;
