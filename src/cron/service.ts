import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CronJob, CronPayload, CronSchedule, CronStore } from "./types.js";

function nowMs(): number {
  return Date.now();
}

function validateTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseNumberSet(
  field: string,
  min: number,
  max: number,
  allowSevenToSunday = false,
): Set<number> | null {
  const set = new Set<number>();
  const parts = field.split(",");

  const normalize = (value: number): number =>
    allowSevenToSunday && value === 7 ? 0 : value;

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      return null;
    }

    let step = 1;
    let base = part;
    if (part.includes("/")) {
      const [lhs, rhs] = part.split("/", 2);
      base = lhs;
      step = Number.parseInt(rhs, 10);
      if (!Number.isInteger(step) || step <= 0) {
        return null;
      }
    }

    if (base === "*") {
      for (let i = min; i <= max; i += step) {
        set.add(normalize(i));
      }
      continue;
    }

    if (base.includes("-")) {
      const [startRaw, endRaw] = base.split("-", 2);
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return null;
      }
      if (start > end) {
        return null;
      }
      if (start < min || end > max) {
        return null;
      }
      for (let i = start; i <= end; i += step) {
        set.add(normalize(i));
      }
      continue;
    }

    const value = Number.parseInt(base, 10);
    if (!Number.isInteger(value)) {
      return null;
    }
    if (value < min || value > max) {
      return null;
    }
    set.add(normalize(value));
  }

  return set;
}

function getDateParts(date: Date, tz?: string | null): {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
} {
  if (!tz) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  }).formatToParts(date);

  const pickNumber = (type: string): number => {
    const part = parts.find((item) => item.type === type)?.value ?? "0";
    return Number.parseInt(part, 10);
  };
  const weekday = parts.find((item) => item.type === "weekday")?.value ?? "Sun";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    minute: pickNumber("minute"),
    hour: pickNumber("hour"),
    dayOfMonth: pickNumber("day"),
    month: pickNumber("month"),
    dayOfWeek: weekdayMap[weekday] ?? 0,
  };
}

function computeNextCronRun(expr: string, now: number, tz?: string | null): number | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const [minuteField, hourField, domField, monthField, dowField] = fields;
  const minutes = parseNumberSet(minuteField, 0, 59);
  const hours = parseNumberSet(hourField, 0, 23);
  const days = parseNumberSet(domField, 1, 31);
  const months = parseNumberSet(monthField, 1, 12);
  const dows = parseNumberSet(dowField, 0, 7, true);
  if (!minutes || !hours || !days || !months || !dows) {
    return null;
  }

  const oneMinute = 60_000;
  let candidate = now - (now % oneMinute) + oneMinute;
  const maxIterations = 60 * 24 * 366;

  for (let i = 0; i < maxIterations; i += 1) {
    const date = new Date(candidate);
    const parts = getDateParts(date, tz);
    if (
      minutes.has(parts.minute) &&
      hours.has(parts.hour) &&
      days.has(parts.dayOfMonth) &&
      months.has(parts.month) &&
      dows.has(parts.dayOfWeek)
    ) {
      return candidate;
    }
    candidate += oneMinute;
  }

  return null;
}

function computeNextRun(schedule: CronSchedule, now: number): number | null {
  if (schedule.kind === "at") {
    return schedule.atMs && schedule.atMs > now ? schedule.atMs : null;
  }
  if (schedule.kind === "every") {
    if (!schedule.everyMs || schedule.everyMs <= 0) {
      return null;
    }
    return now + schedule.everyMs;
  }
  if (schedule.kind === "cron") {
    if (!schedule.expr) {
      return null;
    }
    return computeNextCronRun(schedule.expr, now, schedule.tz ?? undefined);
  }
  return null;
}

function normalizeStore(input: unknown): CronStore {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { version: 1, jobs: [] };
  }
  const data = input as Record<string, unknown>;
  const jobsRaw = Array.isArray(data.jobs) ? data.jobs : [];
  const jobs: CronJob[] = [];
  for (const item of jobsRaw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const schedule =
      typeof rec.schedule === "object" && rec.schedule !== null
        ? (rec.schedule as Record<string, unknown>)
        : {};
    const payload =
      typeof rec.payload === "object" && rec.payload !== null
        ? (rec.payload as Record<string, unknown>)
        : {};
    const state =
      typeof rec.state === "object" && rec.state !== null
        ? (rec.state as Record<string, unknown>)
        : {};

    jobs.push({
      id: typeof rec.id === "string" ? rec.id : randomUUID().slice(0, 8),
      name: typeof rec.name === "string" ? rec.name : "job",
      enabled: rec.enabled !== false,
      schedule: {
        kind:
          schedule.kind === "at" || schedule.kind === "every" || schedule.kind === "cron"
            ? schedule.kind
            : "every",
        atMs: typeof schedule.atMs === "number" ? schedule.atMs : null,
        everyMs: typeof schedule.everyMs === "number" ? schedule.everyMs : null,
        expr: typeof schedule.expr === "string" ? schedule.expr : null,
        tz: typeof schedule.tz === "string" ? schedule.tz : null,
      },
      payload: {
        kind: "agent_turn",
        message: typeof payload.message === "string" ? payload.message : "",
        deliver: payload.deliver === true,
        channel: typeof payload.channel === "string" ? payload.channel : null,
        to: typeof payload.to === "string" ? payload.to : null,
      },
      state: {
        nextRunAtMs: typeof state.nextRunAtMs === "number" ? state.nextRunAtMs : null,
        lastRunAtMs: typeof state.lastRunAtMs === "number" ? state.lastRunAtMs : null,
        lastStatus:
          state.lastStatus === "ok" || state.lastStatus === "error" || state.lastStatus === "skipped"
            ? state.lastStatus
            : null,
        lastError: typeof state.lastError === "string" ? state.lastError : null,
      },
      createdAtMs: typeof rec.createdAtMs === "number" ? rec.createdAtMs : nowMs(),
      updatedAtMs: typeof rec.updatedAtMs === "number" ? rec.updatedAtMs : nowMs(),
      deleteAfterRun: rec.deleteAfterRun === true,
    });
  }

  return {
    version: 1,
    jobs,
  };
}

function validateScheduleForAdd(schedule: CronSchedule): void {
  if (schedule.tz && schedule.kind !== "cron") {
    throw new Error("tz can only be used with cron schedules");
  }
  if (schedule.tz && !validateTimeZone(schedule.tz)) {
    throw new Error(`unknown timezone '${schedule.tz}'`);
  }
  if (schedule.kind === "cron") {
    if (!schedule.expr) {
      throw new Error("cron schedule requires expr");
    }
    if (computeNextCronRun(schedule.expr, nowMs(), schedule.tz ?? undefined) === null) {
      throw new Error("invalid cron expression");
    }
  }
  if (schedule.kind === "every") {
    if (!schedule.everyMs || schedule.everyMs <= 0) {
      throw new Error("every schedule requires everyMs > 0");
    }
  }
  if (schedule.kind === "at") {
    if (!schedule.atMs) {
      throw new Error("at schedule requires atMs");
    }
  }
}

export class CronService {
  private store: CronStore | null = null;
  private lastMtime = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  onJob?: (job: CronJob) => Promise<string | null>;

  constructor(
    private readonly storePath: string,
    onJob?: (job: CronJob) => Promise<string | null>,
  ) {
    this.onJob = onJob;
  }

  private async loadStore(): Promise<CronStore> {
    if (this.store) {
      try {
        const fileStat = await stat(this.storePath);
        if (fileStat.mtimeMs === this.lastMtime) {
          return this.store;
        }
      } catch {
        return this.store;
      }
    }

    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.store = normalizeStore(parsed);
      const fileStat = await stat(this.storePath);
      this.lastMtime = fileStat.mtimeMs;
      return this.store;
    } catch {
      this.store = { version: 1, jobs: [] };
      return this.store;
    }
  }

  private async saveStore(): Promise<void> {
    if (!this.store) {
      return;
    }
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(this.store, null, 2)}\n`, "utf8");
    try {
      const fileStat = await stat(this.storePath);
      this.lastMtime = fileStat.mtimeMs;
    } catch {
      // Ignore mtime sync failures.
    }
  }

  private recomputeNextRuns(): void {
    if (!this.store) {
      return;
    }
    const now = nowMs();
    for (const job of this.store.jobs) {
      if (!job.enabled) {
        continue;
      }
      job.state.nextRunAtMs = computeNextRun(job.schedule, now);
    }
  }

  private getNextWakeAt(): number | null {
    if (!this.store) {
      return null;
    }
    let min: number | null = null;
    for (const job of this.store.jobs) {
      if (!job.enabled) {
        continue;
      }
      const candidate = job.state.nextRunAtMs;
      if (!candidate) {
        continue;
      }
      if (min === null || candidate < min) {
        min = candidate;
      }
    }
    return min;
  }

  private armTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.running) {
      return;
    }
    const nextWakeAt = this.getNextWakeAt();
    if (!nextWakeAt) {
      return;
    }
    const delay = Math.max(0, nextWakeAt - nowMs());
    this.timer = setTimeout(() => {
      void this.onTimer();
    }, delay);
  }

  private async onTimer(): Promise<void> {
    if (!this.running) {
      return;
    }
    const store = await this.loadStore();
    const now = nowMs();
    const dueJobs = store.jobs.filter((job) => {
      if (!job.enabled) {
        return false;
      }
      if (!job.state.nextRunAtMs) {
        return false;
      }
      return now >= job.state.nextRunAtMs;
    });

    for (const job of dueJobs) {
      await this.executeJob(job);
    }
    await this.saveStore();
    this.armTimer();
  }

  private async executeJob(job: CronJob): Promise<void> {
    const startedAt = nowMs();
    try {
      if (this.onJob) {
        await this.onJob(job);
      }
      job.state.lastStatus = "ok";
      job.state.lastError = null;
    } catch (error) {
      job.state.lastStatus = "error";
      job.state.lastError = error instanceof Error ? error.message : String(error);
    }
    job.state.lastRunAtMs = startedAt;
    job.updatedAtMs = nowMs();

    if (job.schedule.kind === "at") {
      if (job.deleteAfterRun) {
        if (this.store) {
          this.store.jobs = this.store.jobs.filter((item) => item.id !== job.id);
        }
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = null;
      }
      return;
    }
    job.state.nextRunAtMs = computeNextRun(job.schedule, nowMs());
  }

  async start(): Promise<void> {
    this.running = true;
    await this.loadStore();
    this.recomputeNextRuns();
    await this.saveStore();
    this.armTimer();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async listJobs(includeDisabled = false): Promise<CronJob[]> {
    const store = await this.loadStore();
    const jobs = includeDisabled ? store.jobs : store.jobs.filter((job) => job.enabled);
    return [...jobs].sort((a, b) => {
      const ax = a.state.nextRunAtMs ?? Number.MAX_SAFE_INTEGER;
      const bx = b.state.nextRunAtMs ?? Number.MAX_SAFE_INTEGER;
      return ax - bx;
    });
  }

  async addJob(options: {
    name: string;
    schedule: CronSchedule;
    message: string;
    deliver?: boolean;
    channel?: string | null;
    to?: string | null;
    deleteAfterRun?: boolean;
  }): Promise<CronJob> {
    validateScheduleForAdd(options.schedule);
    const store = await this.loadStore();
    const now = nowMs();
    const payload: CronPayload = {
      kind: "agent_turn",
      message: options.message,
      deliver: options.deliver === true,
      channel: options.channel ?? null,
      to: options.to ?? null,
    };

    const job: CronJob = {
      id: randomUUID().slice(0, 8),
      name: options.name,
      enabled: true,
      schedule: {
        kind: options.schedule.kind,
        atMs: options.schedule.atMs ?? null,
        everyMs: options.schedule.everyMs ?? null,
        expr: options.schedule.expr ?? null,
        tz: options.schedule.tz ?? null,
      },
      payload,
      state: {
        nextRunAtMs: computeNextRun(options.schedule, now),
        lastRunAtMs: null,
        lastStatus: null,
        lastError: null,
      },
      createdAtMs: now,
      updatedAtMs: now,
      deleteAfterRun: options.deleteAfterRun === true,
    };

    store.jobs.push(job);
    await this.saveStore();
    this.armTimer();
    return job;
  }

  async removeJob(jobId: string): Promise<boolean> {
    const store = await this.loadStore();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((job) => job.id !== jobId);
    const removed = store.jobs.length < before;
    if (removed) {
      await this.saveStore();
      this.armTimer();
    }
    return removed;
  }

  async status(): Promise<{ jobs: number; running: boolean }> {
    const store = await this.loadStore();
    return {
      jobs: store.jobs.length,
      running: this.running,
    };
  }
}

