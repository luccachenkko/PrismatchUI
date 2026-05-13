import type {
  CompetitorLink,
  DashboardStats,
  PriceRun,
  Product,
  ProductDetail,
  RunReport,
  Schedule,
  SchedulePayload
} from "./telegramTypes.js";

type RequestOptions = RequestInit & {
  timeoutMs?: number;
};

export class AgentApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
  }
}

export class AgentClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async health(): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("/api/health");
  }

  async products(): Promise<{ products: Product[]; stats: DashboardStats }> {
    return this.request<{ products: Product[]; stats: DashboardStats }>("/api/products");
  }

  async product(productId: number): Promise<ProductDetail> {
    return this.request<ProductDetail>(`/api/products/${productId}`);
  }

  async findProductBySku(sku: string): Promise<ProductDetail | null> {
    const normalizedSku = sku.trim().toLowerCase();
    const { products } = await this.products();
    const matches = products.filter((product) => product.sku?.trim().toLowerCase() === normalizedSku);

    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1) {
      throw new Error(`Flera produkter har SKU ${sku}. Kan inte välja säkert.`);
    }

    return this.product(matches[0].id);
  }

  async createCompetitorLink(productId: number, url: string): Promise<CompetitorLink> {
    const response = await this.request<{ competitorLink: CompetitorLink }>(
      `/api/products/${productId}/competitor-links`,
      {
        method: "POST",
        body: JSON.stringify({ url, enabled: true })
      }
    );

    return response.competitorLink;
  }

  async startPriceRun(): Promise<PriceRun> {
    const response = await this.request<{ run: PriceRun }>("/api/price-runs", {
      method: "POST",
      timeoutMs: 15 * 60 * 1000
    });

    return response.run;
  }

  async priceRuns(): Promise<PriceRun[]> {
    const response = await this.request<{ runs: PriceRun[] }>("/api/price-runs");
    return response.runs;
  }

  async priceRunReport(runId: number): Promise<RunReport> {
    return this.request<RunReport>(`/api/price-runs/${runId}`);
  }

  async schedules(): Promise<Schedule[]> {
    const response = await this.request<{ schedules: Schedule[] }>("/api/schedules");
    return response.schedules;
  }

  async schedule(scheduleId: number): Promise<Schedule | null> {
    const schedules = await this.schedules();
    return schedules.find((schedule) => schedule.id === scheduleId) ?? null;
  }

  async createSchedule(payload: SchedulePayload): Promise<Schedule> {
    const response = await this.request<{ schedule: Schedule }>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return response.schedule;
  }

  async updateSchedule(scheduleId: number, payload: Partial<SchedulePayload>): Promise<Schedule> {
    const response = await this.request<{ schedule: Schedule }>(`/api/schedules/${scheduleId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    return response.schedule;
  }

  async deleteSchedule(scheduleId: number): Promise<void> {
    await this.request<{ ok: true }>(`/api/schedules/${scheduleId}`, { method: "DELETE" });
  }

  async runScheduleNow(scheduleId: number): Promise<{ schedule: Schedule; run: PriceRun | null }> {
    return this.request<{ schedule: Schedule; run: PriceRun | null }>(`/api/schedules/${scheduleId}/run-now`, {
      method: "POST",
      timeoutMs: 15 * 60 * 1000
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...options.headers
        }
      });

      const payload = (await readJson(response)) as Record<string, unknown>;

      if (!response.ok) {
        const details = [payload["error"], payload["details"]].filter(Boolean).join(" ");
        throw new AgentApiError(details || `Backend svarade HTTP ${response.status}.`, response.status);
      }

      return payload as T;
    } catch (error) {
      if (error instanceof AgentApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AgentApiError("Backend svarade inte inom tidsgränsen.");
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new AgentApiError(`Backend kunde inte nås: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AgentApiError("Backend svarade inte med giltig JSON.", response.status);
  }
}
