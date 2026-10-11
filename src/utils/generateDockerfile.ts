import type { BuildConfig } from "../types/buildConfig";

export function generateDockerfile(config: BuildConfig): string {
  const buildCommands = config.commands
    .map((command) => `RUN ${command}`)
    .join("\n");

  return `FROM ${config.baseImage}:${config.version}

WORKDIR /app

COPY . .

${buildCommands}

EXPOSE ${config.port}

CMD ["sh", "-c", "${config.startCommand}"]
`;
}