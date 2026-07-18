import { NextRequest, NextResponse } from "next/server";
import {
  isAuthed,
  createSession,
  destroySession,
  verifyPassword,
} from "@/lib/auth";
import {
  listInquiries,
  getInquiry,
  updateInquiry,
  addNote,
  metrics,
  reminders,
} from "@/lib/store";
import { nextBestAction } from "@/lib/reges";
import type { Status } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRM data API — one JSON endpoint, action-routed, behind the single-password
 * session. Actions: login, logout, session, list, metrics, update, note,
 * reminders, suggest (AI next-best-action). Ported from backend/api.php.
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty */
  }
  const action = String(body.action ?? "");

  // ── Public auth actions ──
  if (action === "login") {
    const ok = verifyPassword(String(body.password ?? ""));
    if (ok) createSession();
    return NextResponse.json({ ok });
  }
  if (action === "logout") {
    destroySession();
    return NextResponse.json({ ok: true });
  }
  if (action === "session") {
    return NextResponse.json({ authed: isAuthed() });
  }

  // ── Everything below requires auth ──
  if (!isAuthed()) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  switch (action) {
    case "list":
      return NextResponse.json({ inquiries: listInquiries() });

    case "metrics":
      return NextResponse.json(metrics());

    case "reminders":
      return NextResponse.json({ reminders: reminders() });

    case "update": {
      const id = String(body.id ?? "");
      const patch: { status?: Status; quote_amount?: number | null } = {};
      const valid: Status[] = ["new", "reviewing", "quoted", "won", "lost"];
      if (body.status && valid.includes(body.status)) patch.status = body.status;
      if (Object.prototype.hasOwnProperty.call(body, "quote_amount")) {
        patch.quote_amount = body.quote_amount === null ? null : Number(body.quote_amount) | 0;
      }
      if (!id || Object.keys(patch).length === 0) return NextResponse.json({ ok: false });
      return NextResponse.json({ ok: updateInquiry(id, patch) });
    }

    case "note": {
      const id = String(body.id ?? "");
      const text = String(body.body ?? "").trim();
      if (!id || !text) return NextResponse.json({ ok: false });
      return NextResponse.json({ ok: addNote(id, text, body.remind_at || null) });
    }

    case "suggest": {
      const id = String(body.id ?? "");
      const inq = getInquiry(id);
      if (!inq) return NextResponse.json({ error: "not found" }, { status: 404 });
      const action = await nextBestAction(inq);
      return NextResponse.json({ suggestion: action });
    }

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
