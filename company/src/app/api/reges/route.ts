import { NextRequest, NextResponse } from "next/server";
import { conciergeReply, type ChatTurn } from "@/lib/reges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** REGES concierge chat endpoint. */
export async function POST(req: NextRequest) {
  let payload: { message?: string; history?: ChatTurn[] };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ reply: "Bad request.", live: false }, { status: 400 });
  }

  const message = String(payload.message ?? "").trim().slice(0, 2000);
  if (!message) {
    return NextResponse.json({ reply: "Ask me anything about our work.", live: false });
  }

  const history = Array.isArray(payload.history)
    ? payload.history
        .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
        .slice(-8)
    : [];

  const { reply, live } = await conciergeReply(history, message);
  return NextResponse.json({ reply, live });
}
