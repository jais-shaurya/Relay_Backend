import type { BuildConfig } from "../types/buildConfig";

export function generateDockerfile(config: BuildConfig): string {
  const buildCommands = config.commands
    .filter((command) => command.trim().length > 0)
    .map((command) => `RUN ${command}`)
    .join("\n");

  const buildSection = buildCommands.length > 0 ? `\n${buildCommands}\n` : "";

  return `FROM ${config.baseImage}:${config.version}

WORKDIR /app

COPY . .${buildSection}
EXPOSE ${config.port}

CMD ["sh", "-c", ${JSON.stringify(config.startCommand)}]
`;
}
