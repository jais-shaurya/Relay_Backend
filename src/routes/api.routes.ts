import { Router } from 'express';

import projectRoutes from './project.routes.js';
import deploymentRoutes from './deployment.routes.js';
import runtimeRoutes from './runtime.routes.js';
import buildRoutes from './build.routes.js';
import userRoutes from './user.routes.js';
import authRoutes from './auth.routes.js';

import { verifyFirebaseToken } from '../middleware/firebase.js';

const router = Router();

router.use('/auth', authRoutes);

router.use(verifyFirebaseToken);

router.use('/projects', projectRoutes);
router.use(deploymentRoutes);
router.use('/runtimes', runtimeRoutes);
router.use('/builds', buildRoutes);
router.use('/users', userRoutes);

export default router;
