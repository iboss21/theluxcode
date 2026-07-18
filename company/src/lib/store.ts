/**
 * JSON-file data store. Zero-config, no native deps — runs anywhere with a
 * writable disk (VPS, container, `next start`). For heavy production traffic
 * or serverless (read-only FS) swap this module for Postgres/MySQL; the exported
 * function surface is the contract the rest of the app depends on.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Inquiry, Note, Status } from "./types";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

interface DB {
  inquiries: Inquiry[];
}

function ensure(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ inquiries: [] }, null, 2));
  }
}

function read(): DB {
  ensure();
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    const db = JSON.parse(raw) as DB;
    if (!Array.isArray(db.inquiries)) db.inquiries = [];
    return db;
  } catch {
    return { inquiries: [] };
  }
}

function write(db: DB): void {
  ensure();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, STORE_FILE); // atomic-ish replace
}

const now = () => new Date().toISOString();
const id = () => crypto.randomBytes(9).toString("hex");

export function newRef(): string {
  return "LAK-" + crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

export function createInquiry(
  data: Omit<Inquiry, "id" | "created_at" | "notes">
): Inquiry {
  const db = read();
  const inq: Inquiry = { ...data, id: id(), created_at: now(), notes: [] };
  db.inquiries.unshift(inq);
  write(db);
  return inq;
}

export function listInquiries(): Inquiry[] {
  return read().inquiries;
}

export function getInquiry(inqId: string): Inquiry | undefined {
  return read().inquiries.find((i) => i.id === inqId);
}

export function updateInquiry(
  inqId: string,
  patch: { status?: Status; quote_amount?: number | null }
): boolean {
  const db = read();
  const inq = db.inquiries.find((i) => i.id === inqId);
  if (!inq) return false;
  if (patch.status) inq.status = patch.status;
  if (Object.prototype.hasOwnProperty.call(patch, "quote_amount")) {
    inq.quote_amount = patch.quote_amount === null ? null : Number(patch.quote_amount) | 0;
  }
  write(db);
  return true;
}

export function addNote(inqId: string, body: string, remind_at?: string | null): boolean {
  const db = read();
  const inq = db.inquiries.find((i) => i.id === inqId);
  if (!inq) return false;
  const note: Note = {
    id: id(),
    inquiry_id: inqId,
    created_at: now(),
    body,
    remind_at: remind_at || null,
  };
  inq.notes.push(note);
  write(db);
  return true;
}

export interface Metrics {
  counts: Record<string, number>;
  value: Record<string, number>;
  total: number;
  won_value: number;
  pipeline_value: number;
  conversion: number;
}

export function metrics(): Metrics {
  const rows = read().inquiries;
  const out: Metrics = {
    counts: {},
    value: {},
    total: 0,
    won_value: 0,
    pipeline_value: 0,
    conversion: 0,
  };
  for (const r of rows) {
    const v = (r.quote_amount ?? r.ai_expected) || 0;
    out.counts[r.status] = (out.counts[r.status] || 0) + 1;
    out.value[r.status] = (out.value[r.status] || 0) + v;
    out.total += 1;
    if (r.status === "won") out.won_value += v;
    if (["new", "reviewing", "quoted"].includes(r.status)) out.pipeline_value += v;
  }
  const won = out.counts.won || 0;
  const lost = out.counts.lost || 0;
  out.conversion = won + lost ? Math.round((won / (won + lost)) * 100) : 0;
  return out;
}

export function reminders(): (Note & { name: string; ref: string })[] {
  const rows = read().inquiries;
  const today = new Date().toISOString().slice(0, 10);
  const out: (Note & { name: string; ref: string })[] = [];
  for (const r of rows) {
    for (const n of r.notes) {
      if (n.remind_at && n.remind_at <= today) {
        out.push({ ...n, name: r.name, ref: r.ref });
      }
    }
  }
  return out.sort((a, b) => (a.remind_at! < b.remind_at! ? -1 : 1));
}
