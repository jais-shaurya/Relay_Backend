import { z } from 'zod';

const positiveIdSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe());

export const projectIdParamsSchema = z.object({ projectId: positiveIdSchema }).strict();

const projectFields = {
  name: z.string().trim().min(1).max(100),
  runtimeId: z.number().int().positive().safe(),
  repoUrl: z.string().url().refine((value) => ['http:', 'https:', 'ssh:', 'git:'].includes(new URL(value).protocol), 'Repository URL must use HTTP, HTTPS, SSH, or Git.'),
  branch: z.string().trim().min(1).max(255),
  runtimeVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  installCommand: z.string().max(2000),
  buildCommand: z.string().max(2000),
  startCommand: z.string().max(2000),
  port: z.number().int().min(1).max(65535),
};

export const createProjectBodySchema = z.object({
  ...projectFields,
  branch: projectFields.branch.default('main'),
}).strict();

const updateProjectInputSchema = z.object(projectFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'At least one project field is required.');

type UpdateProjectBodyFields = z.infer<typeof updateProjectInputSchema>;
type DefinedOptional<T> = { [Key in keyof T]?: Exclude<T[Key], undefined> };
export type UpdateProjectBody = DefinedOptional<UpdateProjectBodyFields>;

export const updateProjectBodySchema = updateProjectInputSchema.transform((body) =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as UpdateProjectBody,
);

export type ProjectIdParams = z.infer<typeof projectIdParamsSchema>;
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
