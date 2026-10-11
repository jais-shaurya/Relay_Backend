export interface DeployAppParams {
    name: string;
    image: string;
    port: number;
    replicas?: number;
    namespace?: string;
}