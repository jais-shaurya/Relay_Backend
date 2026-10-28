import type { Request, Response } from 'express';

import { db } from '../prisma/db.js';
import { runtimeIdParamsSchema } from '../validation/runtime.schema.js';

export async function getRuntimes(req: Request, res: Response) {
  try {
    const runtimes = await db.orm.public.Runtime.select('id', 'name', 'baseImage').orderBy((runtime) => runtime.name.asc()).all();
    return res.status(200).json({ runtimes });
  } catch (error) {
    console.error('Failed to list runtimes.');
    return res.status(500).json({ message: 'Unable to list runtimes.' });
  }
}

export async function getRuntime(req: Request, res: Response) {
  const parsedParams = runtimeIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success) return res.status(400).json({ message: 'Invalid runtime ID.', errors: parsedParams.error.issues });
  const runtimeId = parsedParams.data.runtimeId;
  try {
    const runtime = await db.orm.public.Runtime.select('id', 'name', 'baseImage').where({ id: runtimeId }).first();
    if (!runtime) return res.status(404).json({ message: 'Runtime not found.' });
    return res.status(200).json({ runtime });
  } catch (error) {
    console.error('Failed to retrieve runtime.');
    return res.status(500).json({ message: 'Unable to retrieve runtime.' });
  }
}
