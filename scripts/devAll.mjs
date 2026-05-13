import { spawn } from "node:child_process";
import readline from "node:readline";

const isWindows = process.platform === "win32";

const tasks = [
  { name: "backend", script: "dev:backend" },
  { name: "frontend", script: "frontend:dev" },
  { name: "agent", script: "agent:dev" },
];

const children = new Map();
let shuttingDown = false;

function prefixStream(name, stream, isError = false) {
  if (!stream) return;

  const rl = readline.createInterface({ input: stream });
  rl.on("line", (line) => {
    const output = `[${name}] ${line}`;
    if (isError) console.error(output);
    else console.log(output);
  });
}

function startTask(task) {
  // Windows is more reliable when npm is launched through cmd.exe instead of
  // spawning npm.cmd directly. This avoids spawn EINVAL on some Node/Windows setups.
  const command = isWindows ? "cmd.exe" : "npm";
  const args = isWindows
    ? ["/d", "/s", "/c", `npm run ${task.script}`]
    : ["run", task.script];

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
    windowsHide: false,
  });

  children.set(task.name, child);
  prefixStream(task.name, child.stdout);
  prefixStream(task.name, child.stderr, true);

  child.on("error", (error) => {
    console.error(`[${task.name}] Kunde inte starta: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    children.delete(task.name);

    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    console.error(`[dev:all] ${task.name} stoppade (${reason}). Stoppar övriga processer.`);
    shutdown(code ?? 1);
  });
}

function killProcessTree(child) {
  if (!child?.pid) return;

  if (isWindows) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });

    killer.on("error", () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore shutdown errors.
      }
    });

    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore shutdown errors.
    }
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\n[dev:all] Stänger backend, frontend och Telegram-agent...");
  for (const child of children.values()) {
    killProcessTree(child);
  }

  setTimeout(() => process.exit(exitCode), 750).unref();
}

console.log("[dev:all] Startar backend, frontend och Telegram-agent...");
console.log("[dev:all] Avsluta alla med Ctrl+C.");

for (const task of tasks) {
  startTask(task);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(`[dev:all] Oväntat fel: ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
