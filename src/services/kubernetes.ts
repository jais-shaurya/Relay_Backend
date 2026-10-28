import * as k8s from "@kubernetes/client-node";
import type { DeployAppParams } from "../types/kubernetes";

const kubeConfig = new k8s.KubeConfig();
kubeConfig.loadFromFile(
  process.env.KUBECONFIG ?? "/home/shivam/.kube/config",
);
kubeConfig.setCurrentContext(
  process.env.KUBE_CONTEXT ?? "kind-relay-local",
);

const appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
const networkingApi = kubeConfig.makeApiClient(
    k8s.NetworkingV1Api
);

export function isNotFound(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const err = error as Record<string, any>;
    if (err.code === 404 || err.status === 404 || err.statusCode === 404) return true;
    if (err.response?.statusCode === 404 || err.response?.status === 404) return true;
    if (err.body?.code === 404 || err.response?.body?.code === 404) return true;
    if (err.reason === "NotFound" || err.body?.reason === "NotFound" || err.response?.body?.reason === "NotFound") return true;
    return false;
}

async function deleteIfPresent(operation: () => Promise<unknown>) {
    try {
        await operation();
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
}

export class KubernetesService {
    public async deployApp(params: DeployAppParams) {
        const {name, image, port, replicas=1,  namespace="default"} = params;
        const hostname = `${name}.localhost`;
        const labels = { app: name };

        const deployment: k8s.V1Deployment = {
            metadata: { name, namespace },
            spec: {
                replicas: replicas ?? 1,
                selector: { matchLabels: labels },
                template: {
                    metadata: { labels },
                    spec: {
                        containers: [
                            {
                                name,
                                image: image,
                                ports: [
                                    { containerPort: port },
                                ],
                            },
                        ],
                    },
                },
            },
        };

        const service: k8s.V1Service = {
            metadata: { name, namespace },
            spec: {
                type: "ClusterIP",
                selector: labels,
                ports: [
                    {
                        port: port,
                        targetPort: port,
                    },
                ],
            },
        };

        const ingress: k8s.V1Ingress = {
            metadata: { name, namespace },
            spec: {
                ingressClassName: "nginx",
                rules: [
                    {
                        host: hostname,
                        http: {
                            paths: [
                                {
                                    path: "/",
                                    pathType: "Prefix",
                                    backend: {
                                        service: {
                                            name,
                                            port: { number: port },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        };

        await appsApi.createNamespacedDeployment({
            namespace,
            body: deployment,
        });

        try {
            await coreApi.createNamespacedService({
                namespace,
                body: service,
            });

            await networkingApi.createNamespacedIngress({
                namespace,
                body: ingress,
            });
        } catch (error) {
            // Roll back resources created by this attempt.
            await networkingApi.deleteNamespacedIngress({
                name,
                namespace,
            }).catch(() => undefined);

            await coreApi.deleteNamespacedService({
                name,
                namespace,
            }).catch(() => undefined);

            await appsApi.deleteNamespacedDeployment({
                name,
                namespace,
            }).catch(() => undefined);

            throw error;
        }

        return {
            name,
            namespace,
            image: image,
            serviceName: name,
            hostname,
            url: `http://${hostname}`,
        };
    }

    public async getDeploymentStatus(
        name: string,
        namespace = "default",
    ) {
        const deployment =
            await appsApi.readNamespacedDeployment({
                name,
                namespace,
            });

        return {
            name,
            replicas: deployment.status?.replicas ?? 0,
            readyReplicas:
                deployment.status?.readyReplicas ?? 0,
            availableReplicas:
                deployment.status?.availableReplicas ?? 0,
            conditions: deployment.status?.conditions ?? [],
        };
    }

    public async deleteApp(
        name: string,
        namespace = "default",
    ) {
        await Promise.all([
            deleteIfPresent(() => networkingApi.deleteNamespacedIngress({
                name,
                namespace,
            })),
            deleteIfPresent(() => coreApi.deleteNamespacedService({
                name,
                namespace,
            })),
            deleteIfPresent(() => appsApi.deleteNamespacedDeployment({
                name,
                namespace,
            })),
        ]);

        return { name, namespace, deleted: true };
    }
}

export const kubernetesService = new KubernetesService();
