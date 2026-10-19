import { spawn } from "node:child_process";

function openerFor(platform: NodeJS.Platform): [string, Array<string>] {
  if (platform === "darwin") return ["open", []];
  if (platform === "win32") return ["cmd", ["/c", "start", '""']];
  return ["xdg-open", []];
}

/** Resolves to whether the system browser could be launched. */
export function openBrowser(url: string): Promise<boolean> {
  const [command, args] = openerFor(process.platform);
  return new Promise((resolve) => {
    const child = spawn(command, [...args, url], {
      stdio: "ignore",
      detached: true,
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
