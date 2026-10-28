import { Router } from 'express';

import {
  getUserProfile,
  updateUserProfile,
  deleteUserProfile,
  logoutUser,
} from '../controller/user.controller.js';

const router = Router();

// Get the authenticated user's profile.
router.get('/', getUserProfile);

// Update the authenticated user's profile.
router.patch('/', updateUserProfile);

// Delete the profile and handle associated resources.
router.delete('/', deleteUserProfile);

// Revoke Firebase refresh tokens for server-side logout.
router.post('/logout', logoutUser);

export default router;