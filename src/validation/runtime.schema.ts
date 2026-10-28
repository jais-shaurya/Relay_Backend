import { z } from 'zod';

export const runtimeIdParamsSchema = z.object({
  runtimeId: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe()),
}).strict();

export type RuntimeIdParams = z.infer<typeof runtimeIdParamsSchema>;
