import { z } from 'zod';

export const updateUserProfileBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

export type UpdateUserProfileBody = z.infer<typeof updateUserProfileBodySchema>;
