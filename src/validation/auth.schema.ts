import { z } from 'zod';

export const firebaseAccountSchema = z.object({
  uid: z.string().trim().min(1),
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(100),
}).strict();

export type FirebaseAccount = z.infer<typeof firebaseAccountSchema>;
