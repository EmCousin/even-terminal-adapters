import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);
export function createClient({ cli = process.env.T3_CLI ?? join(homedir(), ".local/bin/t3"), project = process.env.PROJECT_DIR ?? process.cwd(), execute = exec } = {}) {
  async function command(args, timeout = 30000) {
    try {
      const { stdout } = await execute(cli, ["thread", ...args, "--json"], { timeout, maxBuffer: 8 * 1024 * 1024, cwd: project });
      return JSON.parse(stdout);
    } catch { throw new Error("T3 command failed. Check that T3 Code is running and the project is registered."); }
  }
  return {
    list: () => command(["list", "--project", project]),
    read: id => command(["show", "--messages", "100", id]),
    send: (id, text) => command(["send", id, text]),
    start: (text, cwd = project) => command(["start", "--title", text.trim().slice(0, 80), cwd, text]),
  };
}
