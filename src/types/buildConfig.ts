type BaseImage = "node" | "python";

export interface BuildConfig {
  baseImage: BaseImage;
  version: string;
  commands: string[];
  startCommand: string;
  port: number;
}

export interface ProgressiveLogResult {
  text: string;
  nextOffset: number;
  hasMore: boolean;
}