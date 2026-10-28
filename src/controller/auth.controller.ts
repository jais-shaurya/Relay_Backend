import type { Request, Response } from 'express';

import { db } from '../prisma/db.js';
import { firebaseAccountSchema } from '../validation/auth.schema.js';

// Initialize or retrieve the Relay profile after Firebase signup/login.
export async function createOrLoginUser(req: Request, res: Response) {
  if (!req.firebaseUser) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const parsedAccount = firebaseAccountSchema.safeParse(req.firebaseUser);
  if (!parsedAccount.success) {
    return res.status(400).json({ message: 'Invalid verified Firebase account.', errors: parsedAccount.error.issues });
  }
  const firebaseUser = parsedAccount.data;
  const email = firebaseUser.email.trim().toLowerCase();
  const name = firebaseUser.name.trim();

  if (!email || !name) {
    return res.status(400).json({ message: 'A verified Firebase account email and name are required.' });
  }

  try {
    const user = await db.orm.public.User.upsert({
      conflictOn: { firebaseUid: firebaseUser.uid },
      create: {
        firebaseUid: firebaseUser.uid,
        email,
        name,
      },
      // Keep a user-edited profile name while syncing the Firebase email.
      update: { email },
    });
    return res.status(200).json({ user });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'kind' in error &&
      error.kind === 'sql_query' &&
      'sqlState' in error &&
      error.sqlState === '23505'
    ) {
      return res.status(409).json({ message: 'This email is already associated with another Firebase account.' });
    }
    console.error('Failed to initialize user profile.');
    return res.status(500).json({ message: 'Unable to initialize user profile.' });
  }
}
