import { z } from 'zod';

const positiveIdSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe());

export const projectIdParamsSchema = z.object({ projectId: positiveIdSchema }).strict();
export const deploymentIdParamsSchema = z.object({ deploymentId: positiveIdSchema }).strict();

export const createDeploymentBodySchema = z.object({
  replicas: z.number().int().min(1).max(20).optional(),
}).strict();

const startOffsetSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe());
export const deploymentLogsQuerySchema = z.object({
  start: startOffsetSchema.optional().default(0),
}).strict();

export const updateDeploymentBodySchema = z.object({}).passthrough();

export type ProjectIdParams = z.infer<typeof projectIdParamsSchema>;
export type DeploymentIdParams = z.infer<typeof deploymentIdParamsSchema>;
export type CreateDeploymentBody = z.infer<typeof createDeploymentBodySchema>;
export type DeploymentLogsQuery = z.infer<typeof deploymentLogsQuerySchema>;
export type UpdateDeploymentBody = z.infer<typeof updateDeploymentBodySchema>;
