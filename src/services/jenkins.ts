import axios from 'axios';
import dotenv from 'dotenv'
dotenv.config()

const JENKINS_USER = process.env.JENKINS_USER;
const JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN;
const JENKINS_URL = process.env.JENKINS_URL;

import type {TriggerBuildParams, BuildStatus, ProgressiveLogResult} from '../types/jenkins';

if(!JENKINS_API_TOKEN || !JENKINS_URL || !JENKINS_USER){
    console.error("Jenkins env variables are not present in env")
    process.exit(1);
}

export class JenkinsService{
    private getAuthHeader(): string {
        const credentials = Buffer.from(`${JENKINS_USER}:${JENKINS_API_TOKEN}`).toString('base64');
        return `Basic ${credentials}`;
    }

    public async triggerBuild(params: TriggerBuildParams): Promise<string> {
        const url = `${JENKINS_URL}/job/relay-builder/buildWithParameters`;

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
                Authorization: this.getAuthHeader(),
                "Content-Type": "application/x-www-form-urlencoded",
            }
        });

        const queueUrl = response.headers.location;

        if (!queueUrl) {
            throw new Error("Jenkins did not return a queue URL");
        }

        return queueUrl;
    }

    public async getBuildNumberFromQueue(
        queueUrl: string,
        maxAttempts = 20
    ): Promise<number> {
        const url = queueUrl.endsWith("/") ? `${queueUrl}api/json` : `${queueUrl}/api/json`;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await axios.get(url, {
                headers: {
                    Authorization: this.getAuthHeader(),
                },
            });

            const buildNumber = response.data.executable?.number;
            if (buildNumber !== undefined) {
                return buildNumber;
            }

            await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        throw new Error("Timed out waiting for Jenkins build to start");
    }

    public async getBuildStatus(buildNumber: number): Promise<BuildStatus> {
        const url = `${JENKINS_URL}/job/relay-builder/${buildNumber}/api/json`;

        const response = await axios.get(url, {
            headers: {
                Authorization: this.getAuthHeader(),
            },
        });

        const { building, result } = response.data;

        if (building) {
            return "BUILDING";
        }

        return result as BuildStatus;
    }

    public async getProgressiveLog(
        buildNumber: number,
        startOffset = 0
    ): Promise<ProgressiveLogResult> {

        const url =
            `${JENKINS_URL}/job/relay-builder/${buildNumber}` +
            `/logText/progressiveText?start=${startOffset}`;

        const response = await axios.get(url, {
            headers: {
                Authorization: this.getAuthHeader(),
            },
        });

        const nextOffset = parseInt(
            response.headers["x-text-size"] || `${startOffset}`,
            10
        );

        const hasMore = response.headers["x-more-data"] === "true";

        return {
            text: response.data,
            nextOffset,
            hasMore,
        };
    }
}

