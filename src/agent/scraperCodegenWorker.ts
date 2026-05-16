import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { addAgentScraperJobEvent, updateAgentScraperJob } from "../db.js";
import type { AgentScraperJobRow } from "../db.js";

type CommandResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnError: SpawnErrorInfo | null;
  env: Pick<NodeJS.ProcessEnv, "NODE_PATH" | "PATH"> | null;
  stdout: string;
  stderr: string;
  output: string;
};

type SpawnErrorInfo = {
  name: string;
  message: string;
  code: string | null;
};

type RunnerDebug = {
  cwd: string;
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnError: SpawnErrorInfo | null;
  stdoutPath: string;
  stderrPath: string;
  promptPath: string;
  workdirPromptPath: string;
};

type ProcessDebug = {
  cwd: string;
  command: string;
  args: string[];
  nodePath: string | null;
  pathPrefix: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnError: SpawnErrorInfo | null;
};

type FileSnapshotEntry = {
  path: string;
  hash: string;
  content: string;
};

type FileChange = {
  path: string;
  kind: "added" | "modified" | "deleted";
  beforeHash: string | null;
  afterHash: string | null;
  beforeLength: number;
  afterLength: number;
  afterContent: string | null;
};

export type ScraperCodegenResult = {
  ok: boolean;
  job: AgentScraperJobRow;
  failedStep?: string;
  error?: string;
  foundPrice?: string | null;
  currency?: string | null;
  changedFiles: string[];
  disallowedFiles: string[];
  artifactDir: string;
  codexCommand: string;
};

const ALLOWED_STATUSES = new Set(["created", "awaiting_codegen", "failed"]);
const CODEX_TIMEOUT_MS = 20 * 60 * 1000;
const TEST_TIMEOUT_MS = 3 * 60 * 1000;
const TYPECHECK_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_WORKTREE_ROOT_NAME = "prismatch-agent-worktrees";

export async function runScraperCodegenJob(job: AgentScraperJobRow, projectRoot = process.cwd()): Promise<ScraperCodegenResult> {
  if (!ALLOWED_STATUSES.has(job.status)) {
    return failedPreflight(job, projectRoot, `Jobbet har status ${job.status} och kan inte kodgenereras.`);
  }

  if (!job.codex_prompt?.trim()) {
    return failedPreflight(job, projectRoot, "Jobbet saknar Codex-prompt.");
  }

  const artifactDir = path.join(projectRoot, ".agent", "jobs", String(job.id));
  const workDir = path.join(agentWorktreeRoot(), `scraper-job-${job.id}`);
  const promptPath = path.join(artifactDir, "prompt.md");
  const workdirPromptPath = path.join(workDir, "prompt.md");
  ensureInside(projectRoot, artifactDir);
  ensureOutsideProjectRoot(projectRoot, workDir);

  await mkdir(artifactDir, { recursive: true });
  await writeFile(promptPath, job.codex_prompt, "utf8");
  addAgentScraperJobEvent(job.id, "info", "Startar lokal Codex-runner.", { artifactDir, workDir });
  let currentJob = updateAgentScraperJob(job.id, {
    status: "generating",
    codexOutput: null,
    testOutput: null,
    typecheckOutput: null,
    diffPatch: null,
    changedFiles: null,
    resultSummary: "Codex-körning startad."
  });

  let codexOutput = "";
  let scraperTestOutput = "";
  let typecheckOutput = "";
  let diffPatch = "";
  let changedFiles: string[] = [];
  let fileChanges: FileChange[] = [];
  let codexCommand = "";
  let workspaceReady = false;
  let beforeSnapshot = new Map<string, FileSnapshotEntry>();

  try {
    await prepareIsolatedWorkspace(projectRoot, workDir);
    await verifyWorkspace(workDir);
    await writeFile(workdirPromptPath, job.codex_prompt, "utf8");
    workspaceReady = true;
    beforeSnapshot = await takeRelevantSnapshot(workDir);

    const codexVersion = await runCodexVersion(workDir);
    await writeFile(path.join(artifactDir, "codex-version.txt"), codexVersion.output, "utf8");
    if (isCodexMissing(codexVersion) || codexVersion.exitCode !== 0) {
      throw stepError("codex", `Codex CLI hittades inte från agentprocessen. Kör codex --version i samma terminal som agenten.\n${firstRelevantLines(codexVersion.stderr || codexVersion.output)}`);
    }

    const codex = await runCodexExec(workDir, buildCodexStdinPrompt());
    codexCommand = codex.command;
    codexOutput = codex.output;
    await writeFile(path.join(artifactDir, "codex-output.txt"), codexOutput, "utf8");
    await writeFile(path.join(artifactDir, "codex-stdout.txt"), codex.stdout, "utf8");
    await writeFile(path.join(artifactDir, "codex-stderr.txt"), codex.stderr, "utf8");
    await writeRunnerDebug(path.join(artifactDir, "runner-debug.json"), {
      cwd: workDir,
      command: codex.command,
      args: codex.args,
      exitCode: codex.exitCode,
      signal: codex.signal,
      spawnError: codex.spawnError,
      stdoutPath: path.join(artifactDir, "codex-stdout.txt"),
      stderrPath: path.join(artifactDir, "codex-stderr.txt"),
      promptPath,
      workdirPromptPath
    });

    if (codex.exitCode !== 0) {
      throw stepError("codex", `Codex CLI avslutades med exitkod ${codex.exitCode ?? "okänd"}.\n${firstRelevantLines(codex.stderr || codex.output)}`);
    }

    const afterSnapshot = await takeRelevantSnapshot(workDir);
    fileChanges = diffSnapshots(beforeSnapshot, afterSnapshot);
    changedFiles = fileChanges.map((change) => change.path);
    diffPatch = buildDiffSummary(fileChanges);
    await writeChangeArtifacts(artifactDir, fileChanges);

    const disallowedFiles = changedFiles.filter((file) => !isAllowedChangedFile(file, job.domain));
    if (changedFiles.length === 0) {
      throw stepError("diff", "Codex ändrade inga relevanta filer.");
    }

    if (disallowedFiles.length > 0) {
      throw stepError("diff", `Otillåtna filer ändrades: ${disallowedFiles.join(", ")}`);
    }

    currentJob = updateAgentScraperJob(job.id, {
      status: "testing",
      codexOutput,
      resultSummary: "Codex-körning klar. Kör scraper:test och typecheck."
    });

    const verificationTools = await verifyVerificationTools(projectRoot, workDir);

    const scraperTest = await runScraperTestProcess(workDir, job.url, verificationTools.tsxCli, verificationTools.nodeModulesDir, TEST_TIMEOUT_MS);
    scraperTestOutput = scraperTest.output;
    await writeFile(path.join(artifactDir, "scraper-test-output.txt"), scraperTestOutput, "utf8");
    await writeFile(path.join(artifactDir, "scraper-test-stderr.txt"), scraperTest.stderr, "utf8");
    await writeProcessDebug(path.join(artifactDir, "scraper-test-debug.json"), scraperTest, workDir);
    if (scraperTest.spawnError) {
      throw stepError("scraper-test-spawn", processSpawnFailure("scraper:test", scraperTest, workDir));
    }

    if (scraperTest.exitCode !== 0) {
      throw stepError("scraper-test", `scraper:test misslyckades med exitkod ${scraperTest.exitCode ?? "okänd"}.\n${scraperTestFailureReason(scraperTest)}`);
    }

    const typecheck = await runTypecheckProcess(workDir, verificationTools.tscBin, verificationTools.nodeModulesDir, TYPECHECK_TIMEOUT_MS);
    typecheckOutput = typecheck.output;
    await writeFile(path.join(artifactDir, "typecheck-output.txt"), typecheckOutput, "utf8");
    await writeFile(path.join(artifactDir, "typecheck-stderr.txt"), typecheck.stderr, "utf8");
    await writeProcessDebug(path.join(artifactDir, "typecheck-debug.json"), typecheck, workDir);
    if (typecheck.spawnError) {
      throw stepError("typecheck-spawn", processSpawnFailure("typecheck", typecheck, workDir));
    }

    if (typecheck.exitCode !== 0) {
      throw stepError("typecheck", `typecheck misslyckades med exitkod ${typecheck.exitCode ?? "okänd"}.\n${firstRelevantLines(typecheck.output)}`);
    }

    const price = parseReportValue(scraperTestOutput, "Price");
    const currency = parseReportValue(scraperTestOutput, "Currency");
    const summary = [
      "Klar för granskning.",
      price ? `Pris: ${price}` : null,
      currency ? `Valuta: ${currency}` : null,
      `Ändrade filer: ${changedFiles.join(", ")}`,
      `Artefakter: ${artifactDir}`
    ]
      .filter(Boolean)
      .join("\n");

    currentJob = updateAgentScraperJob(job.id, {
      status: "awaiting_user_approval",
      codexOutput,
      testOutput: scraperTestOutput,
      typecheckOutput,
      diffPatch,
      changedFiles: changedFiles.join("\n"),
      resultSummary: summary
    });

    return {
      ok: true,
      job: currentJob,
      foundPrice: price,
      currency,
      changedFiles,
      disallowedFiles: [],
      artifactDir,
      codexCommand
    };
  } catch (error) {
    const failedStep = getStep(error);
    const message = error instanceof Error ? error.message : String(error);
    const disallowedFiles = changedFiles.filter((file) => !isAllowedChangedFile(file, job.domain));

    await writeFileIfMissing(path.join(artifactDir, "codex-output.txt"), codexOutput);
    await writeFileIfMissing(path.join(artifactDir, "scraper-test-output.txt"), scraperTestOutput);
    await writeFileIfMissing(path.join(artifactDir, "typecheck-output.txt"), typecheckOutput);

    if (workspaceReady && fileChanges.length === 0) {
      fileChanges = await takeRelevantSnapshot(workDir)
        .then((afterSnapshot) => diffSnapshots(beforeSnapshot, afterSnapshot))
        .catch(() => []);
      changedFiles = fileChanges.map((change) => change.path);
      diffPatch = buildDiffSummary(fileChanges);
    }

    await writeChangeArtifacts(artifactDir, fileChanges);

    currentJob = updateAgentScraperJob(job.id, {
      status: "failed",
      codexOutput,
      testOutput: scraperTestOutput,
      typecheckOutput,
      diffPatch,
      changedFiles: changedFiles.join("\n"),
      resultSummary: `${failedStep}: ${message}`
    });
    addAgentScraperJobEvent(job.id, "error", message, { failedStep, changedFiles, disallowedFiles });

    return {
      ok: false,
      job: currentJob,
      failedStep,
      error: message,
      changedFiles,
      disallowedFiles,
      artifactDir,
      codexCommand
    };
  }
}

function failedPreflight(job: AgentScraperJobRow, projectRoot: string, error: string): ScraperCodegenResult {
  const artifactDir = path.join(projectRoot, ".agent", "jobs", String(job.id));
  const updated = updateAgentScraperJob(job.id, { status: "failed", resultSummary: error });
  addAgentScraperJobEvent(job.id, "error", error, { failedStep: "preflight" });
  return {
    ok: false,
    job: updated,
    failedStep: "preflight",
    error,
    changedFiles: [],
    disallowedFiles: [],
    artifactDir,
    codexCommand: codexCommandDisplay()
  };
}

async function prepareIsolatedWorkspace(projectRoot: string, workDir: string): Promise<void> {
  ensureOutsideProjectRoot(projectRoot, workDir);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(path.dirname(workDir), { recursive: true });
  await cp(projectRoot, workDir, {
    recursive: true,
    filter: (source) => shouldCopyPath(projectRoot, source)
  });

  const sourceNodeModules = path.join(projectRoot, "node_modules");
  const targetNodeModules = path.join(workDir, "node_modules");
  await symlink(sourceNodeModules, targetNodeModules, process.platform === "win32" ? "junction" : "dir").catch(() => undefined);
}

async function verifyWorkspace(workDir: string): Promise<void> {
  const workspace = await stat(workDir).catch(() => null);
  if (!workspace?.isDirectory()) {
    throw stepError("copy", `Arbetsmappen kunde inte skapas: ${workDir}`);
  }

  const packageJson = await stat(path.join(workDir, "package.json")).catch(() => null);
  if (!packageJson?.isFile()) {
    throw stepError("copy", `package.json saknas i arbetsmappen: ${workDir}`);
  }
}

function shouldCopyPath(projectRoot: string, source: string): boolean {
  const relative = path.relative(projectRoot, source).replace(/\\/g, "/");
  if (!relative) {
    return true;
  }

  if (relative === ".env" || relative.startsWith(".env.")) {
    return false;
  }

  const blocked = [
    ".git",
    "node_modules",
    "frontend/node_modules",
    "dist",
    "build",
    "data",
    "output",
    ".agent",
    ".agent-worktrees",
    ".vite",
    "coverage",
  ];

  return !blocked.some((item) => relative === item || relative.startsWith(`${item}/`));
}

async function runCodexVersion(workDir: string): Promise<CommandResult> {
  const codexCommand = process.env.CODEX_CMD?.trim() || "codex";
  return runCodexCommand(codexCommand, ["--version"], workDir, "", 30_000, `${codexCommand} --version`);
}

async function runCodexExec(workDir: string, stdinPrompt: string): Promise<CommandResult> {
  const codexCommand = process.env.CODEX_CMD?.trim() || "codex";
  const args = ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"];
  return runCodexCommand(codexCommand, args, workDir, stdinPrompt, CODEX_TIMEOUT_MS, `${codexCommand} ${args.join(" ")}`);
}

function runCodexCommand(
  codexCommand: string,
  args: string[],
  workDir: string,
  stdinText: string,
  timeoutMs: number,
  displayCommand: string
): Promise<CommandResult> {
  if (process.platform === "win32" && !path.isAbsolute(codexCommand) && !codexCommand.includes("\\") && !codexCommand.includes("/")) {
    return runCommand("cmd.exe", ["/d", "/s", "/c", codexCommand, ...args], {
      cwd: workDir,
      timeoutMs,
      displayCommand,
      stdinText
    });
  }

  return runCommand(codexCommand, args, {
    cwd: workDir,
    timeoutMs,
    displayCommand,
    stdinText
  });
}

function codexCommandDisplay(): string {
  return `${process.env.CODEX_CMD?.trim() || "codex"} exec --sandbox workspace-write --skip-git-repo-check -`;
}

async function verifyVerificationTools(
  projectRoot: string,
  workDir: string
): Promise<{ tsxCli: string; tscBin: string; nodeModulesDir: string }> {
  const nodeModulesDir = path.join(projectRoot, "node_modules");
  const tsxCli = path.join(nodeModulesDir, "tsx", "dist", "cli.mjs");
  const tscBin = path.join(nodeModulesDir, "typescript", "bin", "tsc");
  const requiredFiles = [tsxCli, tscBin, path.join(workDir, "scripts", "testScraper.ts")];
  const hasTsconfig = await fileExists(path.join(workDir, "tsconfig.json"));
  const hasPackageJson = await fileExists(path.join(workDir, "package.json"));

  for (const filePath of requiredFiles) {
    if (!(await fileExists(filePath))) {
      throw stepError("verifier-preflight", `Verifieringsfil saknas: ${filePath}`);
    }
  }

  if (!hasTsconfig && !hasPackageJson) {
    throw stepError("verifier-preflight", `Varken tsconfig.json eller package.json finns i arbetsmappen: ${workDir}`);
  }

  return { tsxCli, tscBin, nodeModulesDir };
}

function runScraperTestProcess(
  workDir: string,
  url: string,
  tsxCli: string,
  nodeModulesDir: string,
  timeoutMs: number
): Promise<CommandResult> {
  return runCommand(process.execPath, [tsxCli, "scripts/testScraper.ts", url], {
    cwd: workDir,
    timeoutMs,
    env: verificationEnv(nodeModulesDir)
  });
}

function runTypecheckProcess(workDir: string, tscBin: string, nodeModulesDir: string, timeoutMs: number): Promise<CommandResult> {
  return runCommand(process.execPath, [tscBin, "--noEmit"], {
    cwd: workDir,
    timeoutMs,
    env: verificationEnv(nodeModulesDir)
  });
}

function verificationEnv(nodeModulesDir: string): NodeJS.ProcessEnv {
  const binDir = path.join(nodeModulesDir, ".bin");
  return {
    ...process.env,
    NODE_PATH: nodeModulesDir,
    PATH: [binDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter)
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  return Boolean(await stat(filePath).catch(() => null));
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; displayCommand?: string; stdinText?: string; env?: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const displayCommand = options.displayCommand ?? [command, ...args].join(" ");
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: options.env ?? process.env,
        shell: false,
        stdio: options.stdinText !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      resolve(commandResult(displayCommand, args, null, null, spawnErrorInfo(error), options.env ?? null, "", ""));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let spawnError: SpawnErrorInfo | null = null;
    const timer = setTimeout(() => {
      child.kill();
      stderrChunks.push(Buffer.from(`\n[agent] Command timed out after ${options.timeoutMs} ms.\n`));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      spawnError = spawnErrorInfo(error);
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(commandResult(displayCommand, args, null, null, spawnError, options.env ?? null, "", spawnError.message));
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        resolve(commandResult(displayCommand, args, code, signal, spawnError, options.env ?? null, stdout, stderr));
      }
    });

    if (options.stdinText !== undefined) {
      try {
        child.stdin?.end(options.stdinText);
      } catch (error) {
        spawnError = spawnErrorInfo(error);
        child.kill();
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(commandResult(displayCommand, args, null, null, spawnError, options.env ?? null, "", spawnError.message));
        }
      }
    }
  });
}

function commandResult(
  command: string,
  args: string[],
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  spawnError: SpawnErrorInfo | null,
  env: NodeJS.ProcessEnv | null,
  stdout: string,
  stderr: string
): CommandResult {
  return {
    command,
    args,
    exitCode,
    signal,
    spawnError,
    env: env ? { NODE_PATH: env.NODE_PATH, PATH: env.PATH } : null,
    stdout,
    stderr,
    output: [stdout, stderr].filter(Boolean).join("")
  };
}

function spawnErrorInfo(error: unknown): SpawnErrorInfo {
  if (error instanceof Error) {
    const code = typeof (error as Error & { code?: unknown }).code === "string" ? (error as Error & { code: string }).code : null;
    return {
      name: error.name,
      message: error.message,
      code
    };
  }

  return {
    name: "Error",
    message: String(error),
    code: null
  };
}

function isCodexMissing(result: CommandResult): boolean {
  const output = result.output.toLowerCase();
  return (
    result.exitCode === null ||
    output.includes("not recognized") ||
    output.includes("not found") ||
    output.includes("cannot find") ||
    output.includes("hittades inte")
  );
}

function buildCodexStdinPrompt(): string {
  return [
    "Läs prompt.md i projektroten och genomför uppgiften exakt.",
    "Följ alla säkerhetskrav i prompt.md.",
    "Ändra endast filer som prompt.md tillåter."
  ].join("\n");
}

async function writeRunnerDebug(filePath: string, debug: RunnerDebug): Promise<void> {
  await writeFile(filePath, JSON.stringify(debug, null, 2), "utf8");
}

async function writeProcessDebug(filePath: string, result: CommandResult, cwd: string): Promise<void> {
  const debug: ProcessDebug = {
    cwd,
    command: result.command,
    args: result.args,
    nodePath: result.env?.NODE_PATH ?? null,
    pathPrefix: result.env?.PATH?.split(path.delimiter).slice(0, 2).join(path.delimiter) ?? null,
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError
  };

  await writeFile(filePath, JSON.stringify(debug, null, 2), "utf8");
}

function firstRelevantLines(value: string, maxLines = 8): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(0, maxLines).join("\n") || "Ingen stderr/stdout.";
}

function processSpawnFailure(label: string, result: CommandResult, cwd: string): string {
  return [
    `${label} kunde inte startas.`,
    `command: ${result.command}`,
    `args: ${JSON.stringify(result.args)}`,
    `cwd: ${cwd}`,
    `spawnError: ${result.spawnError ? `${result.spawnError.name}: ${result.spawnError.message}${result.spawnError.code ? ` (${result.spawnError.code})` : ""}` : "-"}`
  ].join("\n");
}

function scraperTestFailureReason(result: CommandResult): string {
  const reportError = parseReportValue(result.output, "Error");
  const base = reportError ?? firstRelevantLines(result.stderr || result.output);
  const blockerHint = scraperBlockerHint(result.output);
  return [base, blockerHint].filter(Boolean).join("\n");
}

function scraperBlockerHint(value: string): string | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("http 403") || normalized.includes("403 forbidden") || normalized.includes("cloudflare") || normalized.includes("just a moment")) {
    return "Trolig orsak: sidan blockerar vanlig server-side fetch/bottrafik.";
  }

  return null;
}

function isAllowedChangedFile(file: string, domain: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  const scraperFile = `src/scrapers/${safeDomainFileName(domain)}.ts`;
  return (
    normalized === scraperFile ||
    normalized === "src/scrapers/index.ts" ||
    normalized === "src/scraperSupport.ts" ||
    normalized === "scripts/testScraper.ts"
  );
}

async function takeRelevantSnapshot(workDir: string): Promise<Map<string, FileSnapshotEntry>> {
  const files = await listRelevantFiles(workDir);
  const snapshot = new Map<string, FileSnapshotEntry>();

  for (const file of files) {
    const fullPath = path.join(workDir, file);
    const content = await readFile(fullPath, "utf8");
    snapshot.set(file, {
      path: file,
      hash: createHash("sha256").update(content).digest("hex"),
      content
    });
  }

  return snapshot;
}

async function listRelevantFiles(workDir: string): Promise<string[]> {
  const files = new Set<string>();
  const fixedFiles = ["src/scrapers/index.ts", "src/scraperSupport.ts", "scripts/testScraper.ts", "package.json"];

  for (const file of fixedFiles) {
    const fullPath = path.join(workDir, file);
    const fileStat = await stat(fullPath).catch(() => null);
    if (fileStat?.isFile()) {
      files.add(file);
    }
  }

  const scraperDir = path.join(workDir, "src", "scrapers");
  await collectTsFiles(scraperDir, path.join(workDir, "src", "scrapers"), files);

  return [...files].sort();
}

async function collectTsFiles(dir: string, rootDir: string, files: Set<string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectTsFiles(fullPath, rootDir, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.add(path.join("src", "scrapers", path.relative(rootDir, fullPath)).replace(/\\/g, "/"));
    }
  }
}

function diffSnapshots(before: Map<string, FileSnapshotEntry>, after: Map<string, FileSnapshotEntry>): FileChange[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changes: FileChange[] = [];

  for (const filePath of [...paths].sort()) {
    const beforeEntry = before.get(filePath) ?? null;
    const afterEntry = after.get(filePath) ?? null;

    if (beforeEntry?.hash === afterEntry?.hash) {
      continue;
    }

    changes.push({
      path: filePath,
      kind: beforeEntry && afterEntry ? "modified" : beforeEntry ? "deleted" : "added",
      beforeHash: beforeEntry?.hash ?? null,
      afterHash: afterEntry?.hash ?? null,
      beforeLength: beforeEntry?.content.length ?? 0,
      afterLength: afterEntry?.content.length ?? 0,
      afterContent: afterEntry?.content ?? null
    });
  }

  return changes;
}

async function writeChangeArtifacts(artifactDir: string, changes: FileChange[]): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(artifactDir, "changed-files.txt"), changes.map((change) => change.path).join("\n"), "utf8");
  await writeFile(path.join(artifactDir, "changed-files.json"), JSON.stringify(changes.map(changeForJson), null, 2), "utf8");

  const summary = buildDiffSummary(changes);
  await writeFile(path.join(artifactDir, "diff-summary.txt"), summary, "utf8");
  await writeFile(path.join(artifactDir, "diff.patch"), summary, "utf8");

  const changedFilesDir = path.join(artifactDir, "changed-files");
  await rm(changedFilesDir, { recursive: true, force: true });
  await mkdir(changedFilesDir, { recursive: true });

  for (const change of changes) {
    if (change.afterContent === null) {
      continue;
    }

    await writeFile(path.join(changedFilesDir, artifactFileName(change.path)), change.afterContent, "utf8");
  }
}

function changeForJson(change: FileChange): Omit<FileChange, "afterContent"> {
  return {
    path: change.path,
    kind: change.kind,
    beforeHash: change.beforeHash,
    afterHash: change.afterHash,
    beforeLength: change.beforeLength,
    afterLength: change.afterLength
  };
}

function buildDiffSummary(changes: FileChange[]): string {
  if (changes.length === 0) {
    return "No relevant file changes detected.";
  }

  return changes
    .map((change) =>
      [
        `${change.kind.toUpperCase()} ${change.path}`,
        `before_hash=${change.beforeHash ?? "-"}`,
        `after_hash=${change.afterHash ?? "-"}`,
        `before_length=${change.beforeLength}`,
        `after_length=${change.afterLength}`
      ].join("\n")
    )
    .join("\n\n");
}

function artifactFileName(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

function safeDomainFileName(domain: string): string {
  return (
    domain
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scraper"
  );
}

function parseReportValue(output: string, label: string): string | null {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "im");
  return output.match(pattern)?.[1]?.trim() ?? null;
}

function stepError(step: string, message: string): Error {
  const error = new Error(message) as Error & { step?: string };
  error.step = step;
  return error;
}

function getStep(error: unknown): string {
  return typeof error === "object" && error !== null && "step" in error && typeof (error as { step?: unknown }).step === "string"
    ? (error as { step: string }).step
    : "runner";
}

function agentWorktreeRoot(): string {
  const configured = process.env.AGENT_WORKTREE_ROOT?.trim();
  return configured ? path.resolve(configured) : path.join(os.tmpdir(), DEFAULT_WORKTREE_ROOT_NAME);
}

function ensureInside(projectRoot: string, target: string): void {
  const relative = path.relative(projectRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Ogiltig runner-sökväg: ${target}`);
  }
}

function ensureOutsideProjectRoot(projectRoot: string, target: string): void {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(target));
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw stepError(
      "copy",
      `Ogiltig runner-sökväg: arbetsmappen måste ligga utanför projektroten. projectRoot=${projectRoot}, workDir=${target}`
    );
  }
}

async function writeFileIfMissing(filePath: string, value: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value, "utf8");
  }
}
