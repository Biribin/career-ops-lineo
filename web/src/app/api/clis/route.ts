import { NextResponse } from "next/server";
import { detectClis } from "@/lib/clis";

export const dynamic = "force-dynamic";

// Detects which agnostic CLIs are installed on THIS machine (local-first). The
// web delegates career-ops to one of these in headless mode, on the user's own
// auth/tokens — no API key needed.
//
// `defaultCliId` lets a HEADLESS deployment (the VPS container) decide which CLI
// the UI pre-selects, instead of "whichever installed CLI happens to be first".
// It mirrors the core's own knob (doctor.mjs reads CAREER_OPS_CLI), so one env var
// governs both. Honoured only when that CLI is actually installed — an env var
// pointing at a missing binary must not silently disable the picker.
export async function GET() {
  const clis = detectClis();
  const wanted = process.env.CAREER_OPS_CLI?.trim();
  const defaultCliId = clis.find((c) => c.id === wanted && c.installed)?.id ?? null;
  return NextResponse.json({ clis, defaultCliId });
}
