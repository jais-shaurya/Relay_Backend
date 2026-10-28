import { Router } from 'express';

import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../controller/project.controller.js';

const router = Router();

router.post('/', createProject);
router.get('/', getProjects);
router.get('/:projectId', getProject);
router.patch('/:projectId', updateProject);
router.delete('/:projectId', deleteProject);

export default router;