#!/usr/bin/env node
// Renders scripts/formula/polymodel.rb.ejs into a Homebrew formula on stdout.
// Called from scripts/release.sh after the npm tarball is packed; the rendered
// file is attached to the GitHub release, and ryaninvents/homebrew-tap's
// update-formula workflow pulls it from there.
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const templatePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "formula",
  "polymodel.rb.ejs",
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`render-formula: missing required env var ${name}`);
  return value;
}

const vars = {
  repo: requireEnv("POLYMODEL_FORMULA_REPO"),
  version: requireEnv("POLYMODEL_FORMULA_VERSION"),
  tarballUrl: requireEnv("POLYMODEL_FORMULA_URL"),
  sha256: requireEnv("POLYMODEL_FORMULA_SHA256"),
};

const template = readFileSync(templatePath, "utf8");
process.stdout.write(ejs.render(template, vars, { filename: templatePath }));
