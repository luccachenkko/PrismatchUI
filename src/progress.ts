import readline from "node:readline";

export type ProgressBarOptions = {
  label: string;
  total: number;
  width?: number;
};

export class ProgressBar {
  private readonly label: string;
  private readonly total: number;
  private readonly width: number;
  private current = 0;
  private readonly startedAt = Date.now();
  private active = false;

  constructor(options: ProgressBarOptions) {
    this.label = options.label;
    this.total = Math.max(0, options.total);
    this.width = options.width ?? 32;
  }

  start(): void {
    this.current = 0;
    this.active = true;
    this.render();
  }

  tick(): void {
    this.current = Math.min(this.current + 1, this.total);
    this.render();
  }

  finish(message = "klar"): void {
    this.current = this.total;
    this.render(` ${message}`);
    this.newLine();
    this.active = false;
  }

  fail(message = "avbruten"): void {
    this.render(` ${message}`);
    this.newLine();
    this.active = false;
  }

  newLine(): void {
    if (this.active && process.stdout.isTTY) {
      process.stdout.write("\n");
    }
  }

  private render(extra = ""): void {
    const percent = this.total === 0 ? 100 : Math.round((this.current / this.total) * 100);
    const filledWidth = this.total === 0 ? this.width : Math.round((this.current / this.total) * this.width);
    const bar = `${"=".repeat(filledWidth)}${" ".repeat(Math.max(0, this.width - filledWidth))}`;
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
    const rate = this.current > 0 ? this.current / elapsedSeconds : 0;
    const remaining = this.total - this.current;
    const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;
    const etaText = etaSeconds === null ? "ETA --" : `ETA ${formatDuration(etaSeconds)}`;

    const line = `${this.label}: [${bar}] ${percent}% (${this.current}/${this.total}) ${etaText}${extra}`;

    if (process.stdout.isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(line);
      return;
    }

    process.stdout.write(`${line}\n`);
  }
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
