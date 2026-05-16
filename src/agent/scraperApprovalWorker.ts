import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { addAgentScraperJobEvent, updateAgentScraperJob } from "../db.js";
import type { AgentScraperJobRow } from "../db.js";
import {
  artifactFileName,
  firstRelevantLines,
  runScraperTestProcess,
  runTypecheckProcess,
  scraperTestFailureReason,
  verifyVerificationTools,
  writeProcessDebug
} from "./scraperCodegenWorker.js";

type ArtifactChange = {
  path: string;
  kind: "added" | "modified" | "deleted";
  afterHash: string | null;
};

type BackupEntry = {
  path: string;
  existed: boolean;
  backupFile: string | null;
};

export type ScraperApprovalResult = {
  ok: boolean;
  job: AgentScraperJobRow;
  failedStep?: string;
  error?: string;
  changedFiles: string[];
  artifactDir: string;
  rolledBack: boolean;
};

export type ScraperRejectionResult = {
  ok: true;
  job: AgentScraperJobRow;
};

const TEST_TIMEOUT_MS = 3 * 60 * 1000;
const TYPECHECK_TIMEOUT_MS = 2 * 60 * 1000;

export async function approveScraperJob(job: AgentScraperJobRow, projectRoot = process.cwd()): Promise<ScraperApprovalResult> {
  if (job.status !== "awaiting_user_approval") {
    throw new Error(`Scraper-jobb #${job.id} har status ${job.status} och kan inte godkännas.`);
  }

  const artifactDir = path.join(projectRoot, ".agent", "jobs", String(job.id));
  const backupDir = path.join(artifactDir, "approval-backup");
  ensureInside(projectRoot, artifactDir);
  const changes = await loadArtifactChanges(artifactDir);
  const changedFiles = changes.map((change) => change.path);
  validateApprovalChanges(changes, job.domain);
  await verifyPreviousChecks(artifactDir);
  await verifyArtifactContents(artifactDir, changes);

  const backupManifest = await backupCurrentFiles(projectRoot, backupDir, changes);
  await writeFile(path.join(artifactDir, "approval-backup.json"), JSON.stringify(backupManifest, null, 2), "utf8");

  let rolledBack = false;
  try {
    await applyArtifactFiles(projectRoot, artifactDir, changes);
    await writeFile(path.join(artifactDir, "applied-files.txt"), changedFiles.join("\n"), "utf8");
    await writeFile(
      path.join(artifactDir, "approval-debug.json"),
      JSON.stringify({ projectRoot, artifactDir, backupDir, changedFiles, approvedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );

    const verificationTools = await verifyVerificationTools(projectRoot, projectRoot);
    const scraperTest = await runScraperTestProcess(projectRoot, job.url, verificationTools.tsxCli, verificationTools.nodeModulesDir, TEST_TIMEOUT_MS);
    await writeFile(path.join(artifactDir, "approval-scraper-test-output.txt"), scraperTest.output, "utf8");
    await writeFile(path.join(artifactDir, "approval-scraper-test-stderr.txt"), scraperTest.stderr, "utf8");
    await writeProcessDebug(path.join(artifactDir, "approval-scraper-test-debug.json"), scraperTest, projectRoot);
    if (scraperTest.spawnError) {
      throw stepError("scraper-test", `scraper:test kunde inte startas: ${scraperTest.spawnError.message}`);
    }
    if (scraperTest.exitCode !== 0) {
      throw stepError("scraper-test", scraperTestFailureReason(scraperTest));
    }

    const typecheck = await runTypecheckProcess(projectRoot, verificationTools.tscBin, verificationTools.nodeModulesDir, TYPECHECK_TIMEOUT_MS);
    await writeFile(path.join(artifactDir, "approval-typecheck-output.txt"), typecheck.output, "utf8");
    await writeFile(path.join(artifactDir, "approval-typecheck-stderr.txt"), typecheck.stderr, "utf8");
    await writeProcessDebug(path.join(artifactDir, "approval-typecheck-debug.json"), typecheck, projectRoot);
    if (typecheck.spawnError) {
      throw stepError("typecheck", `typecheck kunde inte startas: ${typecheck.spawnError.message}`);
    }
    if (typecheck.exitCode !== 0) {
      throw stepError("typecheck", firstRelevantLines(typecheck.output));
    }

    const updatedJob = updateAgentScraperJob(job.id, {
      status: "approved",
      resultSummary: [
        "Scraperkod godkänd och applicerad.",
        `Ändrade filer: ${changedFiles.join(", ")}`,
        "scraper:test i huvudprojektet: OK",
        "typecheck i huvudprojektet: OK"
      ].join("\n")
    });
    addAgentScraperJobEvent(job.id, "info", "Scraperkod godkänd och applicerad.", { changedFiles });
    return { ok: true, job: updatedJob, changedFiles, artifactDir, rolledBack };
  } catch (error) {
    const failedStep = getStep(error);
    const message = error instanceof Error ? error.message : String(error);
    await rollbackFiles(projectRoot, backupDir, backupManifest);
    rolledBack = true;
    const updatedJob = updateAgentScraperJob(job.id, {
      status: "failed",
      resultSummary: `approval-${failedStep}: ${message}\nRollback genomförd.`
    });
    addAgentScraperJobEvent(job.id, "error", "Godkännande misslyckades och rollback genomfördes.", {
      failedStep,
      error: message,
      changedFiles
    });
    return { ok: false, job: updatedJob, failedStep, error: message, changedFiles, artifactDir, rolledBack };
  }
}

export function rejectScraperJob(job: AgentScraperJobRow): ScraperRejectionResult {
  if (job.status === "approved") {
    throw new Error(`Scraper-jobb #${job.id} är redan applicerat och kan inte avvisas.`);
  }

  const updatedJob = updateAgentScraperJob(job.id, {
    status: "rejected",
    resultSummary: "Scraper-jobbet avvisades. Inga filer applicerades."
  });
  addAgentScraperJobEvent(job.id, "info", "Scraper-jobb avvisat utan applicering.");
  return { ok: true, job: updatedJob };
}

async function loadArtifactChanges(artifactDir: string): Promise<ArtifactChange[]> {
  const artifactStat = await stat(artifactDir).catch(() => null);
  if (!artifactStat?.isDirectory()) {
    throw new Error(`Artefaktmappen saknas: ${artifactDir}`);
  }

  const jsonPath = path.join(artifactDir, "changed-files.json");
  const json = await readFile(jsonPath, "utf8").catch(() => null);
  if (!json) {
    throw new Error(`changed-files.json saknas: ${jsonPath}`);
  }

  const parsed = JSON.parse(json) as ArtifactChange[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("changed-files.json innehåller inga ändrade filer.");
  }

  return parsed;
}

function validateApprovalChanges(changes: ArtifactChange[], domain: string): void {
  const expectedScraper = `src/scrapers/${safeDomainFileName(domain)}.ts`;
  const disallowed = changes.filter((change) => !isAllowedApprovalFile(change.path, expectedScraper) || change.kind === "deleted");
  if (disallowed.length > 0) {
    throw new Error(`Otillåtna filer i godkännandet: ${disallowed.map((change) => change.path).join(", ")}`);
  }
}

async function verifyPreviousChecks(artifactDir: string): Promise<void> {
  const scraperOutput = await readFile(path.join(artifactDir, "scraper-test-output.txt"), "utf8").catch(() => null);
  const scraperDebug = await readJson<{ exitCode: number | null }>(path.join(artifactDir, "scraper-test-debug.json"));
  const typecheckDebug = await readJson<{ exitCode: number | null }>(path.join(artifactDir, "typecheck-debug.json"));

  if (!scraperOutput || !/^Status:\s*PRICE_FOUND$/im.test(scraperOutput) || scraperDebug?.exitCode !== 0) {
    throw new Error("Tidigare scraper:test är inte verifierat OK.");
  }

  if (typecheckDebug?.exitCode !== 0) {
    throw new Error("Tidigare typecheck är inte verifierad OK.");
  }
}

async function verifyArtifactContents(artifactDir: string, changes: ArtifactChange[]): Promise<void> {
  for (const change of changes) {
    const artifactPath = path.join(artifactDir, "changed-files", artifactFileName(change.path));
    const content = await readFile(artifactPath, "utf8").catch(() => null);
    if (content === null) {
      throw new Error(`Godkänd filcontent saknas i artefakterna: ${change.path}`);
    }

    if (change.afterHash) {
      const actualHash = createHash("sha256").update(content).digest("hex");
      if (actualHash !== change.afterHash) {
        throw new Error(`Artefaktens hash stämmer inte för ${change.path}.`);
      }
    }
  }
}

async function backupCurrentFiles(projectRoot: string, backupDir: string, changes: ArtifactChange[]): Promise<BackupEntry[]> {
  await rm(backupDir, { recursive: true, force: true });
  await mkdir(backupDir, { recursive: true });
  const entries: BackupEntry[] = [];

  for (const change of changes) {
    const targetPath = path.join(projectRoot, change.path);
    const existing = await readFile(targetPath, "utf8").catch(() => null);
    if (existing === null) {
      entries.push({ path: change.path, existed: false, backupFile: null });
      continue;
    }

    const backupFile = artifactFileName(change.path);
    await writeFile(path.join(backupDir, backupFile), existing, "utf8");
    entries.push({ path: change.path, existed: true, backupFile });
  }

  return entries;
}

async function applyArtifactFiles(projectRoot: string, artifactDir: string, changes: ArtifactChange[]): Promise<void> {
  for (const change of changes) {
    const targetPath = path.join(projectRoot, change.path);
    ensureInside(projectRoot, targetPath);
    const content = await readFile(path.join(artifactDir, "changed-files", artifactFileName(change.path)), "utf8");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }
}

async function rollbackFiles(projectRoot: string, backupDir: string, entries: BackupEntry[]): Promise<void> {
  for (const entry of entries) {
    const targetPath = path.join(projectRoot, entry.path);
    ensureInside(projectRoot, targetPath);
    if (!entry.existed) {
      await rm(targetPath, { force: true });
      continue;
    }

    const content = await readFile(path.join(backupDir, entry.backupFile as string), "utf8");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }
}

function isAllowedApprovalFile(filePath: string, expectedScraper: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized === expectedScraper || normalized === "src/scrapers/index.ts" || normalized === "src/scraperSupport.ts";
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

async function readJson<T>(filePath: string): Promise<T | null> {
  const content = await readFile(filePath, "utf8").catch(() => null);
  return content ? (JSON.parse(content) as T) : null;
}

function ensureInside(projectRoot: string, targetPath: string): void {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Ogiltig sökväg utanför projektroten: ${targetPath}`);
  }
}

function stepError(step: string, message: string): Error {
  const error = new Error(message) as Error & { step?: string };
  error.step = step;
  return error;
}

function getStep(error: unknown): string {
  return typeof error === "object" && error !== null && "step" in error && typeof (error as { step?: unknown }).step === "string"
    ? (error as { step: string }).step
    : "approval";
}
