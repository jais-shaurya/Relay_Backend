import type { Request, Response } from "express";

import { db } from "../prisma/db.js";
import {
  createProjectBodySchema,
  projectIdParamsSchema,
  updateProjectBodySchema,
} from "../validation/project.schema.js";

export async function createProject(req: Request, res: Response) {
  const parsedBody = createProjectBodySchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({
      message: "Invalid project configuration.",
      errors: parsedBody.error.issues,
    });

  const firebaseUid = req.firebaseUser?.uid;
  if (!firebaseUid)
    return res.status(401).json({ message: "Authentication required." });

  try {
    const user = await db.orm.public.User.where({ firebaseUid }).first();
    if (!user)
      return res.status(404).json({
        message:
          "User profile not found. Initialize a profile before managing projects.",
      });

    const runtime = await db.orm.public.Runtime.where({
      id: parsedBody.data.runtimeId,
    }).first();
    if (!runtime)
      return res.status(400).json({
        message: "runtimeId does not reference an available runtime.",
      });

    const project = await db.orm.public.Project.create({
      ...parsedBody.data,
      userId: user.id,
    });
    return res.status(201).json({ project });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "sql_query" &&
      "sqlState" in error &&
      error.sqlState === "23505"
    ) {
      return res
        .status(409)
        .json({ message: "A project with that name already exists." });
    }
    console.error("Failed to create project.");
    return res.status(500).json({ message: "Unable to create project." });
  }
}

export async function getProjects(req: Request, res: Response) {
  try {
    const firebaseUid = req.firebaseUser?.uid;
    if (!firebaseUid)
      return res.status(401).json({ message: "Authentication required." });

    const user = await db.orm.public.User.where({ firebaseUid }).first();
    if (!user)
      return res.status(404).json({
        message:
          "User profile not found. Initialize a profile before managing projects.",
      });

    const projects = await db.orm.public.Project.where({ userId: user.id })
      .orderBy((project) => project.createdAt.desc())
      .all();
    return res.status(200).json({ projects });
  } catch (error) {
    console.error("Failed to list projects.");
    return res.status(500).json({ message: "Unable to list projects." });
  }
}

export async function getProject(req: Request, res: Response) {
  const parsedParams = projectIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res.status(400).json({
      message: "Invalid project ID.",
      errors: parsedParams.error.issues,
    });

  const projectId = parsedParams.data.projectId;
  try {
    const firebaseUid = req.firebaseUser?.uid;
    if (!firebaseUid)
      return res.status(401).json({ message: "Authentication required." });

    const user = await db.orm.public.User.where({ firebaseUid }).first();
    if (!user)
      return res.status(404).json({
        message:
          "User profile not found. Initialize a profile before managing projects.",
      });

    const project = await db.orm.public.Project.where({
      id: projectId,
      userId: user.id,
    }).first();
    if (!project)
      return res.status(404).json({ message: "Project not found." });

    return res.status(200).json({ project });
  } catch (error) {
    console.error("Failed to retrieve project.");
    return res.status(500).json({ message: "Unable to retrieve project." });
  }
}

export async function updateProject(req: Request, res: Response) {
  const parsedParams = projectIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res.status(400).json({
      message: "Invalid project ID.",
      errors: parsedParams.error.issues,
    });

  const parsedBody = updateProjectBodySchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({
      message: "Invalid project update.",
      errors: parsedBody.error.issues,
    });

  const projectId = parsedParams.data.projectId;
  try {
    const firebaseUid = req.firebaseUser?.uid;
    if (!firebaseUid)
      return res.status(401).json({ message: "Authentication required." });

    const user = await db.orm.public.User.where({ firebaseUid }).first();
    if (!user)
      return res.status(404).json({
        message:
          "User profile not found. Initialize a profile before managing projects.",
      });

    const result = await db.transaction(async (tx) => {
      const project = await tx.orm.public.Project.where({
        id: projectId,
        userId: user.id,
      })
        .forNoKeyUpdate()
        .first();
      if (!project) return { kind: "missing-project" } as const;

      const deployment = await tx.orm.public.Deployment.where({
        projectId: project.id,
      })
        .limit(1)
        .first();
      if (deployment) return { kind: "has-deployments" } as const;

      if (parsedBody.data.runtimeId !== undefined) {
        const runtime = await tx.orm.public.Runtime.where({
          id: parsedBody.data.runtimeId,
        }).first();
        if (!runtime)
          return { kind: "missing-runtime" } as const;
      }

      const updated = await tx.orm.public.Project.where({
        id: project.id,
        userId: user.id,
      }).update(parsedBody.data);
      if (!updated)
        return { kind: "missing-project" } as const;

      return { kind: "updated", project: updated } as const;
    });

    if (result.kind === "missing-project")
      return res.status(404).json({ message: "Project not found." });
    if (result.kind === "has-deployments")
      return res.status(409).json({
        message:
          "Project configuration cannot be updated after a deployment has been created.",
      });
    if (result.kind === "missing-runtime")
      return res.status(400).json({
        message: "runtimeId does not reference an available runtime.",
      });

    return res.status(200).json({ project: result.project });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "sql_query" &&
      "sqlState" in error &&
      error.sqlState === "23505"
    ) {
      return res
        .status(409)
        .json({ message: "A project with that name already exists." });
    }
    console.error("Failed to update project.");
    return res.status(500).json({ message: "Unable to update project." });
  }
}

export async function deleteProject(req: Request, res: Response) {
  const parsedParams = projectIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid project ID.",
        errors: parsedParams.error.issues,
      });
  const projectId = parsedParams.data.projectId;
  try {
    const firebaseUid = req.firebaseUser?.uid;
    if (!firebaseUid)
      return res.status(401).json({ message: "Authentication required." });
    const user = await db.orm.public.User.where({ firebaseUid }).first();
    if (!user)
      return res
        .status(404)
        .json({
          message:
            "User profile not found. Initialize a profile before managing projects.",
        });

    const result = await db.transaction(async (tx) => {
      const project = await tx.orm.public.Project.where({
        id: projectId,
        userId: user.id,
      })
        .forNoKeyUpdate()
        .first();
      if (!project) return { kind: "missing-project" } as const;

      const deployment = await tx.orm.public.Deployment.where({ projectId })
        .limit(1)
        .first();
      if (deployment) return { kind: "has-deployments" } as const;

      const deleted = await tx.orm.public.Project.where({
        id: projectId,
        userId: user.id,
      }).delete();
      if (!deleted) return { kind: "missing-project" } as const;

      return { kind: "deleted" } as const;
    });

    if (result.kind === "missing-project")
      return res.status(404).json({ message: "Project not found." });
    if (result.kind === "has-deployments")
      return res
        .status(409)
        .json({
          message: "Project cannot be deleted while deployment history exists.",
        });

    return res.status(200).json({ message: "Project deleted." });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "sql_query" &&
      "sqlState" in error &&
      error.sqlState === "23503"
    ) {
      return res
        .status(409)
        .json({
          message: "Project cannot be deleted while deployments reference it.",
        });
    }
    console.error("Failed to delete project.");
    return res.status(500).json({ message: "Unable to delete project." });
  }
}
