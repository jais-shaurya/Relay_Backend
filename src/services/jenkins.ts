import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

import type { TriggerBuildParams, BuildStatus, ProgressiveLogResult } from '../types/jenkins';

export class JenkinsService {
    public isConfigured(): boolean {
        return Boolean(
            process.env.JENKINS_USER?.trim() &&
            process.env.JENKINS_API_TOKEN?.trim() &&
            process.env.JENKINS_URL?.trim()
        );
    }

    private getConfig(): { user: string; apiToken: string; url: string } {
        const user = process.env.JENKINS_USER?.trim();
        const apiToken = process.env.JENKINS_API_TOKEN?.trim();
        const url = process.env.JENKINS_URL?.trim();

        if (!user || !apiToken || !url) {
            throw new Error("Jenkins service is not configured. Missing required environment variables (JENKINS_USER, JENKINS_API_TOKEN, or JENKINS_URL).");
        }

        return {
            user,
            apiToken,
            url: url.replace(/\/+$/, ""),
        };
    }

    private getAuthHeader(user: string, apiToken: string): string {
        const credentials = Buffer.from(`${user}:${apiToken}`).toString('base64');
        return `Basic ${credentials}`;
    }

    public async triggerBuild(params: TriggerBuildParams): Promise<string> {
        const { user, apiToken, url: baseUrl } = this.getConfig();
        const url = `${baseUrl}/job/relay-builder/buildWithParameters`;

        const formData = new URLSearchParams({
            REPO_URL: params.repoUrl,
            BRANCH: params.branch,
            GITHUB_TOKEN: params.githubToken || "",
            DOCKERFILE_CONTENT: params.dockerfileContent,
            IMAGE_NAME: params.imageName,
            IMAGE_TAG: params.imageTag,
        });

        const response = await axios.post(url, formData.toString(), {
            headers: {
                Authorization: this.getAuthHeader(user, apiToken),
                "Content-Type": "application/x-www-form-urlencoded",
            }
        });

        const locationHeader = response.headers.location;
        let rawQueueUrl = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;

        if (!rawQueueUrl) {
            throw new Error("Jenkins did not return a queue URL");
        }

        return this.normalizeQueueUrl(rawQueueUrl, baseUrl);
    }

    public normalizeQueueUrl(rawQueueUrl: string, baseUrl?: string): string {
        const effectiveBaseUrl = (baseUrl ?? this.getConfig().url).replace(/\/+$/, "");
        const match = rawQueueUrl.match(/(?:^|\/)queue\/item\/(\d+)\/?/);
        const queueId = match?.[1];
        if (queueId) {
            return `${effectiveBaseUrl}/queue/item/${queueId}/`;
        }
        if (rawQueueUrl.startsWith("/")) {
            return `${effectiveBaseUrl}${rawQueueUrl}`;
        }
        try {
            const parsed = new URL(rawQueueUrl);
            return `${effectiveBaseUrl}${parsed.pathname}`;
        } catch {
            return rawQueueUrl.startsWith("http") ? rawQueueUrl : `${effectiveBaseUrl}/${rawQueueUrl}`;
        }
    }

    public getQueueId(queueUrl: string): number | null {
        const match = queueUrl.match(/(?:^|\/)queue\/item\/(\d+)\/?/);
        const rawId = match?.[1];
        if (rawId) {
            const id = parseInt(rawId, 10);
            return Number.isSafeInteger(id) ? id : null;
        }
        return null;
    }

    public async getBuildNumberForQueueId(queueId: number): Promise<number | null> {
        const { user, apiToken, url: baseUrl } = this.getConfig();
        const url = `${baseUrl}/job/relay-builder/api/json?tree=builds[number,queueId]`;
        try {
            const response = await axios.get(url, {
                headers: {
                    Authorization: this.getAuthHeader(user, apiToken),
                },
            });
            const builds = response.data?.builds;
            if (Array.isArray(builds)) {
                const match = builds.find(
                    (b: { number?: unknown; queueId?: unknown }) => b.queueId === queueId
                );
                if (match) {
                    if (typeof match.number === "number") return match.number;
                    if (typeof match.number === "string") {
                        const parsed = parseInt(match.number, 10);
                        if (Number.isSafeInteger(parsed)) return parsed;
                    }
                }
            }
        } catch (error) {
            console.warn("Failed to check job builds for queueId:", queueId);
        }
        return null;
    }

    public async getBuildNumberFromQueue(
        queueUrl: string,
        maxAttempts = 20
    ): Promise<number> {
        const { user, apiToken, url: baseUrl } = this.getConfig();
        const normalizedUrl = this.normalizeQueueUrl(queueUrl, baseUrl);
        const url = normalizedUrl.endsWith("/") ? `${normalizedUrl}api/json` : `${normalizedUrl}/api/json`;
        const queueId = this.getQueueId(queueUrl);

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let response;
            try {
                response = await axios.get(url, {
                    headers: {
                        Authorization: this.getAuthHeader(user, apiToken),
                    },
                });
            } catch (err) {
                const is404 =
                    typeof err === "object" &&
                    err !== null &&
                    "response" in err &&
                    (err as { response?: { status?: unknown } }).response?.status === 404;

                if (is404 && queueId !== null) {
                    const fallbackBuildNumber = await this.getBuildNumberForQueueId(queueId);
                    if (fallbackBuildNumber !== null) {
                        return fallbackBuildNumber;
                    }
                }
                throw err;
            }

            if (response.data?.cancelled === true) {
                throw new Error("Jenkins build was cancelled in queue");
            }

            let buildNumber: number | undefined;
            const exec = response.data?.executable;
            if (typeof exec?.number === "number") {
                buildNumber = exec.number;
            } else if (typeof exec?.number === "string") {
                const parsed = parseInt(exec.number, 10);
                if (Number.isSafeInteger(parsed)) buildNumber = parsed;
            } else if (typeof exec?.url === "string") {
                const match = exec.url.match(/\/(\d+)\/?$/);
                const rawUrlId = match?.[1];
                if (rawUrlId) {
                    const parsed = parseInt(rawUrlId, 10);
                    if (Number.isSafeInteger(parsed)) buildNumber = parsed;
                }
            }

            if (typeof buildNumber === "number") {
                return buildNumber;
            }

            if (queueId !== null) {
                const fallbackBuildNumber = await this.getBuildNumberForQueueId(queueId);
                if (fallbackBuildNumber !== null) {
                    return fallbackBuildNumber;
                }
            }

            if (attempt < maxAttempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        }

        if (queueId !== null) {
            const finalFallback = await this.getBuildNumberForQueueId(queueId);
            if (finalFallback !== null) {
                return finalFallback;
            }
        }

        throw new Error("Timed out waiting for Jenkins build to start");
    }

    public async getBuildStatus(buildNumber: number): Promise<BuildStatus> {
        const { user, apiToken, url: baseUrl } = this.getConfig();
        const url = `${baseUrl}/job/relay-builder/${buildNumber}/api/json`;

        const response = await axios.get(url, {
            headers: {
                Authorization: this.getAuthHeader(user, apiToken),
            },
        });

        const { building, result } = response.data;

        if (building || !result) {
            return "BUILDING";
        }

        return result as BuildStatus;
    }

    public async getProgressiveLog(
        buildNumber: number,
        startOffset = 0
    ): Promise<ProgressiveLogResult> {
        const { user, apiToken, url: baseUrl } = this.getConfig();
        const url =
            `${baseUrl}/job/relay-builder/${buildNumber}` +
            `/logText/progressiveText?start=${startOffset}`;

        const response = await axios.get(url, {
            headers: {
                Authorization: this.getAuthHeader(user, apiToken),
            },
            responseType: 'text',
        });

        const parsedOffset = parseInt(
            response.headers["x-text-size"] || `${startOffset}`,
            10
        );
        const nextOffset = Number.isNaN(parsedOffset) ? startOffset : parsedOffset;

        const hasMore = response.headers["x-more-data"] === "true";

        return {
            text: typeof response.data === 'string' ? response.data : String(response.data ?? ""),
            nextOffset,
            hasMore,
        };
    }
}

