import { z } from 'zod';

const positiveIdSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe());
const startOffsetSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe());

export const buildNumberParamsSchema = z.object({ buildNumber: positiveIdSchema }).strict();
export const buildLogsQuerySchema = z.object({
  start: startOffsetSchema.optional().default(0),
}).strict();

export type BuildNumberParams = z.infer<typeof buildNumberParamsSchema>;
export type BuildLogsQuery = z.infer<typeof buildLogsQuerySchema>;
