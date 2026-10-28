
import { Router } from 'express';

import {
  createDeployment,
  getProjectDeployments,
  getDeployment,
  getDeploymentLogs,
  updateDeployment,
  deleteDeployment,
} from '../controller/deployment.controller.js';

const router = Router();

// Canonical project-scoped deployment API.
router.post('/projects/:projectId/deployments', createDeployment);
router.get('/projects/:projectId/deployments', getProjectDeployments);

router.get('/deployments/:deploymentId/logs', getDeploymentLogs);
router.get('/deployments/:deploymentId', getDeployment);
router.patch('/deployments/:deploymentId', updateDeployment);
router.delete('/deployments/:deploymentId', deleteDeployment);

export default router;
