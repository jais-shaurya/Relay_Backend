import type { Request, Response } from "express";

import { db } from "../prisma/db.js";
import { JenkinsService } from "../services/jenkins.js";
import {
  buildLogsQuerySchema,
  buildNumberParamsSchema,
} from "../validation/build.schema.js";

const jenkins = new JenkinsService();

async function ownedDeploymentForBuild(
  req: Request,
  res: Response,
  buildNumber: number,
) {
  const firebaseUid = req.firebaseUser?.uid;
  if (!firebaseUid) {
    res
      .status(req.firebaseUser ? 400 : 401)
      .json({ message: "A verified Firebase UID is required." });
    return null;
  }
  const user = await db.orm.public.User.where({ firebaseUid }).first();
  if (!user) {
    res.status(404).json({ message: "User profile not found." });
    return null;
  }
  const deployment = await db.orm.public.Deployment.where({
    jenkinsBuildNumber: buildNumber,
  })
    .include("Project")
    .first();
  if (!deployment || deployment.Project.userId !== user.id) {
    res.status(404).json({ message: "Build not found." });
    return null;
  }
  return deployment;
}

export async function getBuild(req: Request, res: Response) {
  const parsedParams = buildNumberParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid build number.",
        errors: parsedParams.error.issues,
      });
  const buildNumber = parsedParams.data.buildNumber;
  try {
    const deployment = await ownedDeploymentForBuild(req, res, buildNumber);
    if (!deployment) return;
    const status = await jenkins.getBuildStatus(buildNumber);
    if (status === "BUILDING") {
      await db.orm.public.Deployment.where({ id: deployment.id })
        .where((current) => current.status.in(["PENDING", "BUILDING"]))
        .update({ status: "BUILDING" });
    } else if (["FAILURE", "ABORTED", "UNSTABLE"].includes(status)) {
      await db.orm.public.Deployment.where({ id: deployment.id })
        .where((current) => current.status.in(["PENDING", "BUILDING"]))
        .update({ status: "FAILED" });
    }
    const terminalBuild = ["SUCCESS", "FAILURE", "ABORTED", "UNSTABLE"].includes(status);
    return res
      .status(terminalBuild ? 200 : 202)
      .json({ buildNumber, status, deploymentId: deployment.id });
  } catch (error) {
    console.error("Failed to retrieve build.");
    return res.status(500).json({ message: "Unable to retrieve build." });
  }
}

export async function getBuildLogs(req: Request, res: Response) {
  const parsedParams = buildNumberParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid build number.",
        errors: parsedParams.error.issues,
      });
  const parsedQuery = buildLogsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success)
    return res
      .status(400)
      .json({
        message: "Invalid log offset.",
        errors: parsedQuery.error.issues,
      });
  const { buildNumber } = parsedParams.data;
  const { start } = parsedQuery.data;
  try {
    const deployment = await ownedDeploymentForBuild(req, res, buildNumber);
    if (!deployment) return;
    const logs = await jenkins.getProgressiveLog(buildNumber, start);
    return res.status(200).json({ buildNumber, ...logs });
  } catch (error) {
    console.error("Failed to retrieve build logs.");
    return res.status(500).json({ message: "Unable to retrieve build logs." });
  }
}
