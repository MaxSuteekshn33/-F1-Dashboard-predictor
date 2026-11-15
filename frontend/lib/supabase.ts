"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Accounts, predictions and leagues live in Supabase. Both values are public by design (the anon key only
// allows what the database's row-level security permits); the service-role key must never be used here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export type Pick = { winner: string; p2: string; p3: string; fastest_lap: string | null; safety_car: boolean | null; winner_stops: number | null };

/** Mirrors public.score_prediction in supabase/schema.sql. */
export function score(p: Pick, r: any): number | null {
  if (!r) return null;
  const slot = (mine: string, exact: string, others: string[], pts: number) => (mine === exact ? pts : others.includes(mine) ? 2 : 0);
  return slot(p.winner, r.winner, [r.p2, r.p3], 10) + slot(p.p2, r.p2, [r.winner, r.p3], 6) + slot(p.p3, r.p3, [r.winner, r.p2], 4)
    + (p.fastest_lap && p.fastest_lap === r.fastest_lap ? 3 : 0)
    + (p.safety_car !== null && r.safety_car !== null && r.safety_car !== undefined && p.safety_car === r.safety_car ? 3 : 0)
    + (p.winner_stops !== null && r.winner_stops !== null && r.winner_stops !== undefined && p.winner_stops === r.winner_stops ? 3 : 0);
}
