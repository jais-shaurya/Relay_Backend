export interface TriggerBuildParams {
    repoUrl: string;
    branch: string;
    githubToken?: string;
    dockerfileContent: string;
    imageName: string;
    imageTag: string;
}

export type BuildStatus = "BUILDING" | "SUCCESS" | "FAILURE" | "ABORTED" | "UNSTABLE";

export interface ProgressiveLogResult {
    text: string;
    nextOffset: number;
    hasMore: boolean;
}