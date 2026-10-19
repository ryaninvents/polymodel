#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createEnv, defaultConfigDirectory } from "#infra";
import { loadPolymodelConfig, startPolymodel } from "./composition.ts";
import { CONFIG_TEMPLATE } from "./configTemplate.ts";

const HELP = `Usage: polymodel [command] [options]

Commands:
  serve            Start the OpenAI-compatible server (default)
  models           List the models defined by the current config
  init             Write a starter config to ~/.config/polymodel/config.ts

Options:
  -c, --config     Path to a config file (default: $POLYMODEL_CONFIG or ~/.config/polymodel/config.{ts,mts,mjs,js})
  -p, --port       Port to listen on (default: 4100)
      --host       Host to bind (default: 127.0.0.1)
      --force      Overwrite an existing config with \`init\`
  -v, --version    Print the version
  -h, --help       Show this help
`;

function readVersion(): string {
  // Same relative location from src/app and dist/app.
  const manifest: { version: string } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  return manifest.version;
}

function initConfig(force: boolean): void {
  const directory = defaultConfigDirectory(createEnv(process.env));
  const path = join(directory, "config.ts");
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists (use --force to overwrite)`);
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, CONFIG_TEMPLATE);
  process.stdout.write(`Wrote ${path}\n`);
}

async function listModels(configPath: string | undefined): Promise<void> {
  const { config, source } = await loadPolymodelConfig(configPath);
  process.stdout.write(`Config: ${source}\n`);
  for (const [id, model] of Object.entries(config.models)) {
    process.stdout.write(
      `  ${id}${model.description ? `  ${model.description}` : ""}\n`,
    );
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`Invalid port: ${value}`);
  return port;
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      port: { type: "string", short: "p" },
      host: { type: "string" },
      force: { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(`${readVersion()}\n`);

  const command = positionals[0] ?? "serve";
  switch (command) {
    case "serve":
      await startPolymodel({
        configPath: values.config,
        host: values.host,
        port: parsePort(values.port),
      });
      return;
    case "models":
      return listModels(values.config);
    case "init":
      return initConfig(values.force);
    default:
      throw new Error(
        `Unknown command "${command}". Run \`polymodel --help\`.`,
      );
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `polymodel: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
