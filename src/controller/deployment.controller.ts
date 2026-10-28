import type { Request, Response } from "express";
import crypto from "node:crypto";

import { db } from "../prisma/db.js";
import { JenkinsService } from "../services/jenkins.js";
import { isNotFound, kubernetesService } from "../services/kubernetes.js";
import { generateDockerfile } from "../utils/generateDockerfile.js";
import type { BuildStatus } from "../types/jenkins.js";
import {
  createDeploymentBodySchema,
  deploymentIdParamsSchema,
  deploymentLogsQuerySchema,
  projectIdParamsSchema,
  updateDeploymentBodySchema,
} from "../validation/deployment.schema.js";

const jenkins = new JenkinsService();

interface DeploymentLockData {
  ownerToken: string;
  expiresAt: number;
  action: "PROVISION" | "DELETE";
}

const LOCK_TTL_MS = 45_000;

function parseLock(commitHash: string | null | undefined): DeploymentLockData | null {
  if (!commitHash || typeof commitHash !== "string" || !commitHash.startsWith("lock:")) {
    return null;
  }
  const parts = commitHash.split(":");
  if (parts.length < 4) return null;
  const ownerToken = parts[1];
  const expiresAt = Number(parts[2]);
  const action = parts[3] as "PROVISION" | "DELETE";
  if (!ownerToken || isNaN(expiresAt)) return null;
  return { ownerToken, expiresAt, action };
}

function serializeLock(data: DeploymentLockData): string {
  return `lock:${data.ownerToken}:${data.expiresAt}:${data.action}`;
}

function sanitizeDeployment<T extends { commitHash?: string | null }>(
  deployment: T,
): T;
function sanitizeDeployment<T extends { commitHash?: string | null }>(
  deployment: T | null,
): T | null;
function sanitizeDeployment<T extends { commitHash?: string | null }>(
  deployment: T | null | undefined,
): T | null | undefined {
  if (
    deployment &&
    typeof deployment.commitHash === "string" &&
    deployment.commitHash.startsWith("lock:")
  ) {
    return { ...deployment, commitHash: null };
  }
  return deployment;
}

interface LockAcquisitionSuccess {
  acquired: true;
  ownerToken: string;
  deployment: any;
}

interface LockAcquisitionFailure {
  acquired: false;
  reason: "NOT_FOUND" | "LOCKED" | "TERMINAL" | "PENDING" | "DEPLOYING" | "ERROR";
  deployment?: any;
  lockAction?: "PROVISION" | "DELETE";
}

type LockAcquisitionResult = LockAcquisitionSuccess | LockAcquisitionFailure;

async function acquireDeploymentLock(
  deploymentId: number,
  action: "PROVISION" | "DELETE",
  ttlMs = LOCK_TTL_MS,
): Promise<LockAcquisitionResult> {
  const ownerToken = crypto.randomUUID();
  const expiresAt = Date.now() + ttlMs;
  const lockString = serializeLock({ ownerToken, expiresAt, action });

  try {
    const result = await db.transaction(async (tx) => {
      const deployment = await tx.orm.public.Deployment.where({ id: deploymentId })
        .forNoKeyUpdate()
        .first();

      if (!deployment) {
        return { acquired: false, reason: "NOT_FOUND" } as const;
      }

      const existing = parseLock(deployment.commitHash);
      if (existing && Date.now() < existing.expiresAt && existing.ownerToken !== ownerToken) {
        return { acquired: false, reason: "LOCKED", deployment, lockAction: existing.action } as const;
      }

      if (deployment.status === "DELETED") {
        return { acquired: false, reason: "TERMINAL", deployment } as const;
      }

      if (action === "PROVISION") {
        if (deployment.status === "FAILED") {
          return { acquired: false, reason: "TERMINAL", deployment } as const;
        }
      }

      if (action === "DELETE") {
        if (deployment.status === "PENDING") {
          return { acquired: false, reason: "PENDING", deployment } as const;
        }
        if (deployment.status === "DEPLOYING") {
          return { acquired: false, reason: "DEPLOYING", deployment } as const;
        }
      }

      await tx.orm.public.Deployment.where({ id: deploymentId }).update({
        commitHash: lockString,
      });

      return { acquired: true, ownerToken, deployment } as const;
    });

    return result;
  } catch (error) {
    console.error(`Failed to acquire lock for deployment ${deploymentId}:`, error);
    return { acquired: false, reason: "ERROR" };
  }
}

async function isLockOwned(deploymentId: number, ownerToken: string): Promise<boolean> {
  try {
    const deployment = await db.orm.public.Deployment.where({ id: deploymentId }).first();
    if (!deployment) return false;
    const lock = parseLock(deployment.commitHash);
    if (!lock) return false;
    return lock.ownerToken === ownerToken && Date.now() < lock.expiresAt;
  } catch (error) {
    console.error(`Error checking lock ownership for deployment ${deploymentId}:`, error);
    return false;
  }
}

async function releaseDeploymentLock(deploymentId: number, ownerToken: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const deployment = await tx.orm.public.Deployment.where({ id: deploymentId })
        .forNoKeyUpdate()
        .first();
      if (!deployment) return;
      const lock = parseLock(deployment.commitHash);
      if (lock && lock.ownerToken === ownerToken) {
        await tx.orm.public.Deployment.where({ id: deploymentId }).update({
          commitHash: null,
        });
      }
    });
  } catch (error) {
    console.error(`Failed to release lock for deployment ${deploymentId}:`, error);
  }
}

async function userForRequest(req: Request, res: Response) {
  const firebaseUid = req.firebaseUser?.uid;
  if (!firebaseUid) {
    res.status(401).json({ message: "Authentication required." });
    return null;
  }
  const user = await db.orm.public.User.where({ firebaseUid }).first();
  if (!user) {
    res.status(404).json({
      message:
        "User profile not found. Initialize a profile before managing projects.",
    });
    return null;
  }
  return user;
}

async function getOwnedProject(projectId: number, userId: number) {
  return db.orm.public.Project.where({ id: projectId, userId })
    .include("Runtime")
    .first();
}

async function getOwnedDeployment(deploymentId: number, userId: number) {
  const deployment = await db.orm.public.Deployment.where({ id: deploymentId })
    .include("Project")
    .first();
  return deployment?.Project.userId === userId ? deployment : null;
}

function resourceName(projectId: number, deploymentId: number) {
  return `relay-p${projectId}-d${deploymentId}`;
}

async function deployBuiltImage(
  deployment: {
    id: number;
    projectId: number;
    status: "PENDING" | "BUILDING" | "DEPLOYING" | "DEPLOYED" | "FAILED" | "DELETED";
    image: string;
    replicas: number;
  },
  project: { port: number },
) {
  const lock = await acquireDeploymentLock(deployment.id, "PROVISION");
  if (!lock.acquired) {
    const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
    return {
      complete: current?.status === "DEPLOYED" || current?.status === "FAILED" || current?.status === "DELETED",
      lifecycleStatus: current?.status ?? deployment.status,
    };
  }

  try {
    const currentBefore = await db.orm.public.Deployment.where({ id: deployment.id }).first();
    if (!currentBefore || currentBefore.status === "DELETED" || currentBefore.status === "FAILED") {
      return {
        complete: true,
        lifecycleStatus: currentBefore?.status ?? "DELETED",
      };
    }

    if (currentBefore.status !== "DEPLOYING" && currentBefore.status !== "DEPLOYED") {
      await db.orm.public.Deployment.where({ id: deployment.id })
        .where((current) => current.status.in(["PENDING", "BUILDING"]))
        .update({ status: "DEPLOYING" });
    }

    const name = resourceName(deployment.projectId, deployment.id);
    let existingStatus;
    try {
      existingStatus = await kubernetesService.getDeploymentStatus(name);
    } catch (checkErr) {
      if (isNotFound(checkErr)) {
        existingStatus = null;
      } else {
        console.warn("Transient error checking Kubernetes status; will retry on next poll:", checkErr);
        return { complete: false, lifecycleStatus: "DEPLOYING" };
      }
    }

    if (!existingStatus) {
      const owned = await isLockOwned(deployment.id, lock.ownerToken);
      if (!owned) {
        const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
        return {
          complete: current?.status === "DEPLOYED" || current?.status === "FAILED" || current?.status === "DELETED",
          lifecycleStatus: current?.status ?? "DEPLOYING",
        };
      }

      try {
        await kubernetesService.deleteApp(name);
      } catch (cleanupErr) {
        console.error("Cleanup before reprovisioning failed; will retry on next poll:", cleanupErr);
        return { complete: false, lifecycleStatus: "DEPLOYING" };
      }

      const ownedBeforeDeploy = await isLockOwned(deployment.id, lock.ownerToken);
      if (!ownedBeforeDeploy) {
        const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
        return {
          complete: current?.status === "DEPLOYED" || current?.status === "FAILED" || current?.status === "DELETED",
          lifecycleStatus: current?.status ?? "DEPLOYING",
        };
      }

      const imageToDeploy =
        currentBefore?.image && currentBefore.image !== "pending"
          ? currentBefore.image
          : deployment.image;

      try {
        await kubernetesService.deployApp({
          name,
          image: imageToDeploy,
          port: project.port,
          replicas: deployment.replicas,
        });
      } catch (createErr) {
        console.error("Kubernetes resource creation failed:", createErr);
        try {
          await kubernetesService.deleteApp(name);
        } catch (cleanupErr) {
          console.error("Cleanup after deployment creation failure failed; will retry on next poll:", cleanupErr);
          return { complete: false, lifecycleStatus: "DEPLOYING" };
        }
        await db.orm.public.Deployment.where({ id: deployment.id })
          .where({ status: "DEPLOYING" })
          .update({ status: "FAILED" });
        return { complete: true, lifecycleStatus: "FAILED" };
      }
    }

    let status;
    try {
      status = existingStatus ?? (await kubernetesService.getDeploymentStatus(name));
    } catch (statusErr) {
      console.warn("Transient error checking readiness; will retry on next poll:", statusErr);
      return { complete: false, lifecycleStatus: "DEPLOYING" };
    }

    if (status.readyReplicas >= deployment.replicas) {
      const updated = await db.orm.public.Deployment.where({ id: deployment.id })
        .where({ status: "DEPLOYING" })
        .update({ status: "DEPLOYED" });
      if (updated) return { complete: true, lifecycleStatus: "DEPLOYED", statusDetails: status };
      const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
      return {
        complete: current?.status === "DEPLOYED",
        lifecycleStatus: current?.status ?? "DEPLOYING",
        statusDetails: status,
      };
    }
    return { complete: false, lifecycleStatus: "DEPLOYING", statusDetails: status };
  } finally {
    await releaseDeploymentLock(deployment.id, lock.ownerToken);
  }
}

async function advanceDeployment(
  deployment: {
    id: number;
    projectId: number;
    status:
      "PENDING" | "BUILDING" | "DEPLOYING" | "DEPLOYED" | "FAILED" | "DELETED";
    image: string;
    replicas: number;
    jenkinsQueueUrl: string | null;
    jenkinsBuildNumber: number | null;
    updatedAt?: string;
    createdAt?: string;
  },
  project: { port: number },
) {
  if (
    deployment.status === "DEPLOYED"
    || deployment.status === "DELETED"
    || deployment.status === "FAILED"
  )
    return { status: deployment.status, complete: true };

  if (deployment.status === "DEPLOYING") {
    const lock = await acquireDeploymentLock(deployment.id, "PROVISION");
    if (!lock.acquired) {
      const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
      return {
        status: current?.status ?? "DEPLOYING",
        complete: current?.status === "DEPLOYED" || current?.status === "FAILED" || current?.status === "DELETED",
      };
    }

    try {
      const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
      if (!current || current.status !== "DEPLOYING") {
        return {
          status: current?.status ?? "DELETED",
          complete: true,
        };
      }

      const name = resourceName(deployment.projectId, deployment.id);
      let status;
      let notFound = false;

      try {
        status = await kubernetesService.getDeploymentStatus(name);
      } catch (error) {
        if (isNotFound(error)) {
          notFound = true;
        } else {
          console.warn("Kubernetes deployment status check failed; it will be retried.");
          return { status: "DEPLOYING", complete: false };
        }
      }

      if (notFound) {
        const owned = await isLockOwned(deployment.id, lock.ownerToken);
        if (!owned) {
          const fresh = await db.orm.public.Deployment.where({ id: deployment.id }).first();
          return {
            status: fresh?.status ?? "DEPLOYING",
            complete: fresh?.status === "DEPLOYED" || fresh?.status === "DELETED" || fresh?.status === "FAILED",
          };
        }

        try {
          await kubernetesService.deleteApp(name);
        } catch (cleanupErr) {
          console.error("Cleanup before reprovisioning failed; will retry on next poll:", cleanupErr);
          return { status: "DEPLOYING", complete: false };
        }

        const ownedBeforeDeploy = await isLockOwned(deployment.id, lock.ownerToken);
        if (!ownedBeforeDeploy) {
          const fresh = await db.orm.public.Deployment.where({ id: deployment.id }).first();
          return {
            status: fresh?.status ?? "DEPLOYING",
            complete: fresh?.status === "DEPLOYED" || fresh?.status === "DELETED" || fresh?.status === "FAILED",
          };
        }

        const imageToDeploy =
          current?.image && current.image !== "pending"
            ? current.image
            : deployment.image;

        try {
          await kubernetesService.deployApp({
            name,
            image: imageToDeploy,
            port: project.port,
            replicas: deployment.replicas,
          });
        } catch (deployError) {
          console.error("Failed to recover/provision Kubernetes deployment:", deployError);
          try {
            await kubernetesService.deleteApp(name);
          } catch (cleanupErr) {
            console.error("Cleanup after deployment recovery failure failed; will retry on next poll:", cleanupErr);
            return { status: "DEPLOYING", complete: false };
          }
          const updated = await db.orm.public.Deployment.where({ id: deployment.id })
            .where({ status: "DEPLOYING" })
            .update({ status: "FAILED" });
          if (updated) return { status: "FAILED", complete: true };
          const currentDb = await db.orm.public.Deployment.where({ id: deployment.id }).first();
          return {
            status: currentDb?.status ?? "FAILED",
            complete: currentDb?.status === "DEPLOYED" || currentDb?.status === "DELETED" || currentDb?.status === "FAILED",
          };
        }

        try {
          status = await kubernetesService.getDeploymentStatus(name);
        } catch (statusError) {
          console.warn("Transient error reading status after recovery; will retry on next poll:", statusError);
          return { status: "DEPLOYING", complete: false };
        }
      }

      if (status && status.readyReplicas >= deployment.replicas) {
        const updated = await db.orm.public.Deployment.where({ id: deployment.id })
          .where({ status: "DEPLOYING" })
          .update({ status: "DEPLOYED" });
        if (updated) return { status: "DEPLOYED", complete: true };
        const fresh = await db.orm.public.Deployment.where({ id: deployment.id }).first();
        return {
          status: fresh?.status ?? "DEPLOYING",
          complete: fresh?.status === "DEPLOYED" || fresh?.status === "DELETED" || fresh?.status === "FAILED",
        };
      }

      const conditions = status?.conditions ?? [];
      const hasRolloutFailure = conditions.some(
        (c) => (c.type === "Progressing" && c.status === "False" && c.reason === "ProgressDeadlineExceeded") ||
               (c.type === "ReplicaFailure" && c.status === "True"),
      );
      const DEPLOYMENT_TIMEOUT_MS = 10 * 60 * 1000;
      const timestampStr = deployment.createdAt;
      const elapsed = timestampStr ? Date.now() - new Date(timestampStr).getTime() : 0;
      const isTimedOut = !isNaN(elapsed) && elapsed > DEPLOYMENT_TIMEOUT_MS;

      if (hasRolloutFailure || isTimedOut) {
        console.warn(`Rollout failure detected for deployment ${deployment.id} (failure=${hasRolloutFailure}, timeout=${isTimedOut}). Cleaning up.`);
        try {
          await kubernetesService.deleteApp(name);
        } catch (cleanupError) {
          console.error(`Rollout cleanup failed for deployment ${deployment.id}; will retry cleanup on next poll:`, cleanupError);
          return { status: "DEPLOYING", complete: false };
        }
        const updated = await db.orm.public.Deployment.where({ id: deployment.id })
          .where({ status: "DEPLOYING" })
          .update({ status: "FAILED" });
        if (updated) return { status: "FAILED", complete: true };
        const fresh = await db.orm.public.Deployment.where({ id: deployment.id }).first();
        return {
          status: fresh?.status ?? "FAILED",
          complete: fresh?.status === "DEPLOYED" || fresh?.status === "DELETED" || fresh?.status === "FAILED",
        };
      }

      return { status: "DEPLOYING", complete: false, statusDetails: status };
    } finally {
      await releaseDeploymentLock(deployment.id, lock.ownerToken);
    }
  }

  let buildNumber = deployment.jenkinsBuildNumber;
  if (buildNumber === null) {
    if (deployment.jenkinsQueueUrl === "uncertain") {
      return {
        status: "PENDING",
        complete: false,
        message: "Jenkins build acceptance is uncertain. The deployment is retained to prevent duplicate builds and requires manual verification or deletion.",
      };
    }

    if (!deployment.jenkinsQueueUrl) {
      const timestampStr = deployment.createdAt;
      const elapsed = timestampStr ? Date.now() - new Date(timestampStr).getTime() : 0;
      if (!isNaN(elapsed) && elapsed > 5 * 60 * 1000) {
        await db.orm.public.Deployment.where({ id: deployment.id })
          .where({ status: "PENDING" })
          .update({ status: "FAILED" });
        return { status: "FAILED", complete: true };
      }
      return { status: deployment.status, complete: false };
    }

    try {
      buildNumber = await jenkins.getBuildNumberFromQueue(
        deployment.jenkinsQueueUrl,
        1,
      );
      const updated = await db.orm.public.Deployment.where({ id: deployment.id })
        .where((current) => current.status.in(["PENDING", "BUILDING"]))
        .update({ jenkinsBuildNumber: buildNumber, status: "BUILDING" });
      if (!updated) {
        const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
        return {
          status: current?.status ?? deployment.status,
          complete: current?.status === "DEPLOYED" || current?.status === "FAILED" || current?.status === "DELETED",
        };
      }
      deployment = { ...deployment, jenkinsBuildNumber: buildNumber, status: "BUILDING" };
    } catch (error) {
      const responseStatus =
        typeof error === "object" && error !== null && "response" in error
          ? (error as { response?: { status?: unknown } }).response?.status
          : undefined;
      const isCancelled =
        error instanceof Error &&
        error.message === "Jenkins build was cancelled in queue";
      if (responseStatus === 404 || isCancelled) {
        await db.orm.public.Deployment.where({ id: deployment.id })
          .where((current) => current.status.in(["PENDING", "BUILDING"]))
          .update({ status: "FAILED" });
        return { status: "FAILED", complete: true };
      }
      const QUEUE_TIMEOUT_MS = 10 * 60 * 1000;
      const timestampStr = deployment.createdAt;
      const elapsed = timestampStr ? Date.now() - new Date(timestampStr).getTime() : 0;
      if (!isNaN(elapsed) && elapsed > QUEUE_TIMEOUT_MS) {
        await db.orm.public.Deployment.where({ id: deployment.id })
          .where((current) => current.status.in(["PENDING", "BUILDING"]))
          .update({ status: "FAILED" });
        return { status: "FAILED", complete: true };
      }
      console.warn("Jenkins queue has not returned a build number yet.");
      return { status: deployment.status, complete: false };
    }
  }

  let buildStatus: BuildStatus;
  try {
    buildStatus = await jenkins.getBuildStatus(buildNumber);
  } catch (error) {
    console.warn("Jenkins build status check failed; it will be retried.");
    return { status: deployment.status, complete: false };
  }

  if (buildStatus === "BUILDING" || !buildStatus) {
    if (deployment.status !== "BUILDING") {
      const updated = await db.orm.public.Deployment.where({ id: deployment.id })
        .where({ status: "PENDING" })
        .update({ status: "BUILDING" });
      if (!updated) {
        const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
        return {
          status: current?.status ?? deployment.status,
          complete: current?.status === "DEPLOYED" || current?.status === "FAILED" || current?.status === "DELETED",
        };
      }
      deployment = { ...deployment, status: "BUILDING" };
    }
    return { status: "BUILDING", complete: false, buildStatus: "BUILDING" };
  }

  if (["FAILURE", "ABORTED", "UNSTABLE"].includes(buildStatus)) {
    const updated = await db.orm.public.Deployment.where({ id: deployment.id })
      .where((current) => current.status.in(["PENDING", "BUILDING"]))
      .update({ status: "FAILED" });
    if (updated) return { status: "FAILED", complete: true, buildStatus };
    const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
    return {
      status: current?.status ?? deployment.status,
      complete: current?.status === "DEPLOYED" || current?.status === "FAILED" || current?.status === "DELETED",
      buildStatus,
    };
  }

  if (buildStatus === "SUCCESS") {
    const result = await deployBuiltImage(deployment, project);
    return {
      status: result.lifecycleStatus,
      complete: result.complete,
      statusDetails: "statusDetails" in result ? result.statusDetails : undefined,
      buildStatus: "SUCCESS",
    };
  }

  return { status: deployment.status, complete: false, buildStatus };
}

export async function createDeployment(req: Request, res: Response) {
  const parsedParams = projectIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid project ID.",
        errors: parsedParams.error.issues,
      });
  const parsedBody = createDeploymentBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success)
    return res
      .status(400)
      .json({
        message: "Invalid deployment request.",
        errors: parsedBody.error.issues,
      });
  const projectId = parsedParams.data.projectId;
  try {
    const user = await userForRequest(req, res);
    if (!user) return;
    const replicaCount = parsedBody.data.replicas ?? 1;
    const reservation = await db.transaction(async (tx) => {
      // Serialize deployment reservations for this project. NO KEY UPDATE
      // allows PostgreSQL's FK key-share checks while excluding peer creators.
      const project = await tx.orm.public.Project.where({ id: projectId, userId: user.id })
        .forNoKeyUpdate()
        .first();
      if (!project) return { kind: "missing-project" } as const;
      const runtime = await tx.orm.public.Runtime.where({ id: project.runtimeId }).first();
      if (!runtime) return { kind: "missing-runtime" } as const;
      if (!["node", "python"].includes(runtime.baseImage)) return { kind: "unsupported-runtime" } as const;
      const active = await tx.orm.public.Deployment.where({ projectId })
        .where((deployment) => deployment.status.in(["PENDING", "BUILDING", "DEPLOYING"]))
        .first();
      if (active) return { kind: "active", deploymentId: active.id } as const;
      const deployment = await tx.orm.public.Deployment.create({
        projectId,
        image: "pending",
        url: "pending",
        replicas: replicaCount,
        status: "PENDING",
        commitHash: null,
        jenkinsQueueUrl: null,
        jenkinsBuildNumber: null,
      });
      return { kind: "created", deployment, project, runtime } as const;
    });

    if (reservation.kind === "missing-project") return res.status(404).json({ message: "Project not found." });
    if (reservation.kind === "missing-runtime") return res.status(400).json({ message: "The project's runtime no longer exists." });
    if (reservation.kind === "unsupported-runtime") return res.status(400).json({ message: "The project runtime uses an unsupported Docker base image." });
    if (reservation.kind === "active") {
      return res.status(409).json({
        message: "A deployment is already in progress for this project.",
        deploymentId: reservation.deploymentId,
      });
    }

    const dockerUsername =
      process.env.DOCKER_USERNAME ||
      process.env.DOCKERHUB_USERNAME ||
      process.env.DOCKER_HUB_USERNAME;
    if (!dockerUsername) {
      console.error("Docker Hub configuration is missing (DOCKER_USERNAME).");
      try {
        await db.orm.public.Deployment.where({
          id: reservation.deployment.id,
          status: "PENDING",
        }).update({ status: "FAILED" });
      } catch (updateError) {
        console.error("Failed to mark deployment setup as failed.");
      }
      return res.status(500).json({ message: "Unable to start deployment." });
    }

    const { deployment, project, runtime } = reservation;
    const name = resourceName(project.id, deployment.id);
    const imageName = `${dockerUsername}/${name}`;
    const image = `${imageName}:${deployment.id}`;
    let dockerfile: string;
    try {
      dockerfile = generateDockerfile({
        baseImage: runtime.baseImage as "node" | "python",
        version: project.runtimeVersion,
        commands: [project.installCommand, project.buildCommand].filter(
          (command) => command.trim().length > 0,
        ),
        startCommand: project.startCommand,
        port: project.port,
      });
    } catch (error) {
      console.error("Failed to generate deployment Dockerfile.");
      try {
        await db.orm.public.Deployment.where({ id: deployment.id, status: "PENDING" }).update({ status: "FAILED" });
      } catch (updateError) {
        console.error("Failed to mark deployment setup as failed.");
      }
      return res.status(500).json({ message: "Unable to prepare deployment build." });
    }

    if (!jenkins.isConfigured()) {
      console.error("Jenkins configuration is missing (JENKINS_USER, JENKINS_API_TOKEN, or JENKINS_URL).");
      try {
        await db.orm.public.Deployment.where({ id: deployment.id, status: "PENDING" }).update({ status: "FAILED" });
      } catch (updateError) {
        console.error("Failed to mark deployment setup as failed.");
      }
      return res.status(500).json({ message: "Unable to start deployment." });
    }

    let queueUrl: string;
    try {
      queueUrl = await jenkins.triggerBuild({
        repoUrl: project.repoUrl,
        branch: project.branch,
        dockerfileContent: dockerfile,
        imageName,
        imageTag: String(deployment.id),
        ...(process.env.GITHUB_TOKEN
          ? { githubToken: process.env.GITHUB_TOKEN }
          : {}),
      });
    } catch (error) {
      console.error("Jenkins build request failed with an uncertain outcome.");
      const responseStatus =
        typeof error === "object" && error !== null && "response" in error
          ? (error as { response?: { status?: unknown } }).response?.status
          : undefined;
      if (
        typeof responseStatus === "number"
        && responseStatus >= 400
        && responseStatus < 500
      ) {
        try {
          await db.orm.public.Deployment.where({ id: deployment.id, status: "PENDING" }).update({ status: "FAILED" });
        } catch (updateError) {
          console.error("Failed to mark rejected deployment build as failed.");
        }
        return res.status(502).json({ message: "Jenkins rejected the deployment build." });
      }

      // The request may have reached Jenkins even though this process did not
      // receive a usable queue URL. Keep PENDING to block duplicate builds.
      try {
        await db.orm.public.Deployment.where({ id: deployment.id, status: "PENDING" }).update({
          jenkinsQueueUrl: "uncertain",
        });
      } catch (updateError) {
        console.error("Failed to record uncertain submission state:", updateError);
      }
      return res.status(503).json({
        message: "Jenkins build acceptance is uncertain. The deployment is retained to prevent a duplicate build.",
        deploymentId: deployment.id,
        status: "PENDING",
      });
    }

    // Jenkins accepted the build. Never mark it failed just because later
    // persistence or polling fails; keep the queue URL available for retries.
    let queueInformationSaved = false;
    try {
      await db.orm.public.Deployment.where({ id: deployment.id }).update({
        status: "BUILDING",
        image,
        url: `http://${name}.localhost`,
        jenkinsQueueUrl: queueUrl,
      });
      queueInformationSaved = true;
    } catch (error) {
      console.error("Jenkins accepted the build but its queue URL could not be saved.");
      try {
        await db.orm.public.Deployment.where({ id: deployment.id }).update({
          status: "BUILDING",
          image,
          url: `http://${name}.localhost`,
          jenkinsQueueUrl: queueUrl,
        });
        queueInformationSaved = true;
      } catch (retryError) {
        console.error("Retry saving Jenkins queue information failed.");
        try {
          const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
          queueInformationSaved = current?.jenkinsQueueUrl === queueUrl;
        } catch (readError) {
          console.error("Could not verify persisted Jenkins queue information.");
        }
      }
    }
    if (!queueInformationSaved) {
      return res.status(503).json({
        message: "Jenkins accepted the build, but its status could not be saved. Retry deployment status shortly.",
        deploymentId: deployment.id,
      });
    }

    try {
      const result = await advanceDeployment(
        { ...deployment, image, status: "BUILDING", jenkinsQueueUrl: queueUrl },
        project,
      );
      const latest = await db.orm.public.Deployment.where({
        id: deployment.id,
      }).first();
      if (result.status === "FAILED") {
        return res.status(502).json({ message: "The Jenkins build or Kubernetes deployment failed.", deployment: sanitizeDeployment(latest) });
      }
      if (result.status === "DEPLOYED") return res.status(201).json({ deployment: sanitizeDeployment(latest) });
      return res.status(202).json({
        deployment: sanitizeDeployment(latest),
        buildStatus: "buildStatus" in result ? result.buildStatus : undefined,
      });
    } catch (error) {
      console.error("Failed to advance an accepted deployment.");
      const latest = await db.orm.public.Deployment.where({
        id: deployment.id,
      }).first();
      if (latest?.status === "FAILED") {
        return res.status(502).json({ message: "The Jenkins build or Kubernetes deployment failed.", deployment: sanitizeDeployment(latest) });
      }
      return res.status(503).json({
        message: "Jenkins accepted the build, but deployment status is temporarily unavailable.",
        deployment: sanitizeDeployment(latest),
      });
    }
  } catch (error) {
    console.error("Failed to start deployment.");
    return res.status(500).json({ message: "Unable to start deployment." });
  }
}

export async function getProjectDeployments(req: Request, res: Response) {
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
    const user = await userForRequest(req, res);
    if (!user) return;
    const project = await getOwnedProject(projectId, user.id);
    if (!project)
      return res.status(404).json({ message: "Project not found." });
    const deployments = await db.orm.public.Deployment.where({ projectId })
      .orderBy((deployment) => deployment.createdAt.desc())
      .all();
    return res.status(200).json({ deployments: deployments.map(sanitizeDeployment) });
  } catch (error) {
    console.error("Failed to list deployments.");
    return res.status(500).json({ message: "Unable to list deployments." });
  }
}

export async function getDeployment(req: Request, res: Response) {
  const parsedParams = deploymentIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid deployment ID.",
        errors: parsedParams.error.issues,
      });
  const deploymentId = parsedParams.data.deploymentId;
  try {
    const user = await userForRequest(req, res);
    if (!user) return;
    const deployment = await getOwnedDeployment(deploymentId, user.id);
    if (!deployment)
      return res.status(404).json({ message: "Deployment not found." });
    const result = await advanceDeployment(deployment, deployment.Project);
    const current = await db.orm.public.Deployment.where({
      id: deployment.id,
    }).first();
    const responsePayload: {
      deployment: typeof current;
      buildStatus?: BuildStatus;
      message?: string;
    } = {
      deployment: sanitizeDeployment(current),
    };
    if ("buildStatus" in result && result.buildStatus) {
      responsePayload.buildStatus = result.buildStatus as BuildStatus;
    }
    if ("message" in result && typeof (result as { message?: unknown }).message === "string") {
      responsePayload.message = (result as { message: string }).message;
    }
    return res
      .status(result.complete ? 200 : 202)
      .json(responsePayload);
  } catch (error) {
    console.error("Failed to retrieve deployment.");
    return res.status(500).json({ message: "Unable to retrieve deployment." });
  }
}

export async function getDeploymentLogs(req: Request, res: Response) {
  const parsedParams = deploymentIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid deployment ID.",
        errors: parsedParams.error.issues,
      });
  const parsedQuery = deploymentLogsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success)
    return res
      .status(400)
      .json({
        message: "Invalid log offset.",
        errors: parsedQuery.error.issues,
      });
  const deploymentId = parsedParams.data.deploymentId;
  const { start } = parsedQuery.data;
  try {
    const user = await userForRequest(req, res);
    if (!user) return;
    const deployment = await getOwnedDeployment(deploymentId, user.id);
    if (!deployment)
      return res.status(404).json({ message: "Deployment not found." });
    if (deployment.jenkinsBuildNumber === null)
      return res
        .status(409)
        .json({ message: "Jenkins build has not started yet." });
    const logs = await jenkins.getProgressiveLog(
      deployment.jenkinsBuildNumber,
      start,
    );
    return res.status(200).json(logs);
  } catch (error) {
    console.error("Failed to retrieve deployment logs.");
    return res
      .status(500)
      .json({ message: "Unable to retrieve deployment logs." });
  }
}

export async function updateDeployment(req: Request, res: Response) {
  const parsedParams = deploymentIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid deployment ID.",
        errors: parsedParams.error.issues,
      });
  const parsedBody = updateDeploymentBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success)
    return res
      .status(400)
      .json({
        message: "Invalid deployment update.",
        errors: parsedBody.error.issues,
      });
  return res
    .status(501)
    .json({
      message:
        "Deployment updates are not supported by the current Kubernetes service.",
    });
}

export async function deleteDeployment(req: Request, res: Response) {
  const parsedParams = deploymentIdParamsSchema.safeParse(req.params);
  if (!parsedParams.success)
    return res
      .status(400)
      .json({
        message: "Invalid deployment ID.",
        errors: parsedParams.error.issues,
      });
  const deploymentId = parsedParams.data.deploymentId;

  const user = await userForRequest(req, res);
  if (!user) return;

  const lock = await acquireDeploymentLock(deploymentId, "DELETE");
  if (!lock.acquired) {
    if (lock.reason === "NOT_FOUND") {
      return res.status(404).json({ message: "Deployment not found." });
    }
    const current = lock.deployment ?? (await getOwnedDeployment(deploymentId, user.id));
    if (!current) {
      return res.status(404).json({ message: "Deployment not found." });
    }
    if (current.status === "DELETED") {
      return res.status(200).json({ message: "Deployment is already deleted.", deploymentId: current.id, status: "DELETED" });
    }
    if (lock.reason === "DEPLOYING" || current.status === "DEPLOYING" || lock.lockAction === "PROVISION") {
      return res.status(409).json({ message: "Deployment is still being provisioned. Retry deletion after provisioning completes." });
    }
    if (lock.reason === "PENDING" || current.status === "PENDING") {
      return res.status(409).json({ message: "Deployment setup is still in progress. Retry deletion after its status advances." });
    }
    return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
  }

  try {
    const deployment = await getOwnedDeployment(deploymentId, user.id);
    if (!deployment)
      return res.status(404).json({ message: "Deployment not found." });
    if (deployment.status === "DELETED") {
      return res.status(200).json({ message: "Deployment is already deleted.", deploymentId: deployment.id, status: "DELETED" });
    }
    if (deployment.status === "DEPLOYING") {
      return res.status(409).json({ message: "Deployment is still being provisioned. Retry deletion after provisioning completes." });
    }
    if (deployment.status === "PENDING") {
      return res.status(409).json({ message: "Deployment setup is still in progress. Retry deletion after its status advances." });
    }
    if (deployment.status === "BUILDING") {
      if (deployment.jenkinsBuildNumber === null) {
        return res.status(409).json({ message: "The Jenkins build may still be queued and cannot be cancelled." });
      }
      let buildStatus: BuildStatus;
      try {
        buildStatus = await jenkins.getBuildStatus(deployment.jenkinsBuildNumber);
      } catch (err) {
        return res.status(500).json({ message: "Unable to delete deployment resources." });
      }
      if (buildStatus === "BUILDING") {
        return res.status(409).json({ message: "The Jenkins build is active and cannot be cancelled." });
      }
      if (buildStatus === "SUCCESS") {
        const ownedBeforeCleanup = await isLockOwned(deployment.id, lock.ownerToken);
        if (!ownedBeforeCleanup) {
          return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
        }
        try {
          await kubernetesService.deleteApp(resourceName(deployment.projectId, deployment.id));
        } catch (cleanupErr) {
          return res.status(500).json({ message: "Unable to delete deployment resources." });
        }
        const ownedBeforeUpdate = await isLockOwned(deployment.id, lock.ownerToken);
        if (!ownedBeforeUpdate) {
          return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
        }
        const deleted = await db.orm.public.Deployment.where({ id: deployment.id })
          .where((current) => current.status.in(["PENDING", "BUILDING"]))
          .update({ status: "DELETED" });
        if (deleted) {
          return res.status(200).json({ message: "Deployment deleted before Kubernetes provisioning.", deploymentId: deployment.id, status: "DELETED" });
        }
        const currentCheck = await db.orm.public.Deployment.where({ id: deployment.id }).first();
        if (currentCheck?.status === "DELETED") {
          return res.status(200).json({ message: "Deployment deleted before Kubernetes provisioning.", deploymentId: deployment.id, status: "DELETED" });
        }
        return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
      }
      const deleted = await db.orm.public.Deployment.where({ id: deployment.id })
        .where((current) => current.status.in(["PENDING", "BUILDING"]))
        .update({ status: "DELETED" });
      if (deleted) {
        return res.status(200).json({ message: "Failed build history marked deleted; no Kubernetes resources were created.", deploymentId: deployment.id, status: "DELETED" });
      }
      const currentCheck = await db.orm.public.Deployment.where({ id: deployment.id }).first();
      if (currentCheck?.status === "DELETED") {
        return res.status(200).json({ message: "Failed build history marked deleted; no Kubernetes resources were created.", deploymentId: deployment.id, status: "DELETED" });
      }
      return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
    }

    if (
      deployment.status === "FAILED"
      && deployment.jenkinsQueueUrl !== null
      && deployment.jenkinsBuildNumber === null
    ) {
      return res.status(409).json({ message: "The Jenkins build may still be queued; deletion cannot be confirmed yet." });
    }
    if (deployment.status === "FAILED" && deployment.jenkinsBuildNumber !== null) {
      try {
        const buildStatus = await jenkins.getBuildStatus(deployment.jenkinsBuildNumber);
        if (buildStatus === "BUILDING") {
          return res.status(409).json({ message: "The Jenkins build is still active and cannot be cancelled." });
        }
      } catch (err) {
        console.warn("Could not check Jenkins build status during deletion of failed deployment:", err);
        return res.status(500).json({ message: "Unable to delete deployment resources." });
      }
    }

    const ownedBeforeCleanup = await isLockOwned(deployment.id, lock.ownerToken);
    if (!ownedBeforeCleanup) {
      return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
    }

    // Clean up Kubernetes resources and ensure cleanup succeeded before marking DELETED
    try {
      await kubernetesService.deleteApp(resourceName(deployment.projectId, deployment.id));
    } catch (cleanupErr) {
      console.error("Kubernetes cleanup failed during deletion:", cleanupErr);
      return res.status(500).json({ message: "Unable to delete deployment resources." });
    }

    const ownedBeforeUpdate = await isLockOwned(deployment.id, lock.ownerToken);
    if (!ownedBeforeUpdate) {
      return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
    }

    const deleted = await db.orm.public.Deployment.where({ id: deployment.id })
      .where((current) => current.status.in(["DEPLOYED", "FAILED"]))
      .update({ status: "DELETED" });
    if (!deleted) {
      const current = await db.orm.public.Deployment.where({ id: deployment.id }).first();
      if (current?.status !== "DELETED") {
        return res.status(409).json({ message: "Deployment lifecycle advanced concurrently. Retry deletion after checking its status." });
      }
    }
    return res
      .status(200)
      .json({
        message: "Deployment resources deleted.",
        deploymentId: deployment.id,
        status: "DELETED",
      });
  } catch (error) {
    console.error("Failed to delete deployment:", error);
    return res
      .status(500)
      .json({ message: "Unable to delete deployment resources." });
  } finally {
    await releaseDeploymentLock(deploymentId, lock.ownerToken);
  }
}
