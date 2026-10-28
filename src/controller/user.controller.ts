import type { Request, Response } from 'express';

import auth from '../config/firebase.js';
import { db } from '../prisma/db.js';
import { firebaseAccountSchema } from '../validation/auth.schema.js';
import { updateUserProfileBodySchema } from '../validation/user.schema.js';

function getFirebaseAccount(req: Request, res: Response) {
  if (!req.firebaseUser) {
    res.status(401).json({ message: 'Authentication required.' });
    return null;
  }
  const parsed = firebaseAccountSchema.safeParse(req.firebaseUser);
  if (!parsed.success) {
    res.status(401).json({ message: 'Invalid verified Firebase account.' });
    return null;
  }
  return parsed.data;
}

export async function getUserProfile(req: Request, res: Response) {
  const account = getFirebaseAccount(req, res);
  if (!account) return;
  try {
    const user = await db.orm.public.User.where({ firebaseUid: account.uid }).first();
    if (!user) return res.status(404).json({ message: 'User profile not found.' });
    return res.status(200).json({ user });
  } catch (error) {
    console.error('Failed to retrieve user profile.');
    return res.status(500).json({ message: 'Unable to retrieve user profile.' });
  }
}

export async function updateUserProfile(req: Request, res: Response) {
  const account = getFirebaseAccount(req, res);
  if (!account) return;
  const parsedBody = updateUserProfileBodySchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ message: 'Invalid profile update.', errors: parsedBody.error.issues });
  try {
    const updatedUser = await db.orm.public.User.where({ firebaseUid: account.uid }).update(parsedBody.data);
    if (!updatedUser) return res.status(404).json({ message: 'User profile not found.' });
    return res.status(200).json({ user: updatedUser });
  } catch (error) {
    console.error('Failed to update user profile.');
    return res.status(500).json({ message: 'Unable to update user profile.' });
  }
}

export async function deleteUserProfile(req: Request, res: Response) {
  const account = getFirebaseAccount(req, res);
  if (!account) return;
  try {
    const user = await db.orm.public.User.where({ firebaseUid: account.uid }).delete();
    if (!user) return res.status(404).json({ message: 'User profile not found.' });
    return res.status(200).json({ message: 'User profile deleted.' });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'kind' in error &&
      error.kind === 'sql_query' &&
      'sqlState' in error &&
      error.sqlState === '23503'
    ) {
      return res.status(409).json({ message: 'User profile cannot be deleted while projects still reference it.' });
    }
    console.error('Failed to delete user profile.');
    return res.status(500).json({ message: 'Unable to delete user profile.' });
  }
}

export async function logoutUser(req: Request, res: Response) {
  const account = getFirebaseAccount(req, res);
  if (!account) return;
  try {
    await auth.revokeRefreshTokens(account.uid);
    return res.status(200).json({ message: 'Refresh tokens revoked.' });
  } catch (error) {
    console.error('Failed to revoke Firebase refresh tokens.');
    return res.status(500).json({ message: 'Unable to log out.' });
  }
}
