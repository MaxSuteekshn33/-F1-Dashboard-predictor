"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Accounts, predictions and leagues live in Supabase. Both values are public by design (the anon key only
// allows what the database's row-level security permits); the service-role key must never be used here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Links in account emails (password reset, email confirmation) come back to /account with the outcome in the URL.
// Read it before the client starts, because the client consumes and clears those parameters as it signs the user in.
const landing = typeof window !== "undefined" ? new URLSearchParams(window.location.hash.slice(1) + "&" + window.location.search.slice(1)) : null;
let recovering = landing?.get("type") === "recovery";
/** Set when the visitor arrived from an expired or already-used email link. */
export const linkError: string | null = landing?.get("error_code") === "otp_expired" || /expired|invalid/i.test(landing?.get("error_description") || "")
  ? "That link has expired or has already been used. Links in account emails work once and only for a limited time — request a new one below."
  : landing?.get("error_description") ? landing.get("error_description")!.replace(/\+/g, " ") : null;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
supabase?.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") recovering = true; });

/** True while the visitor is signed in only through a password-reset link and has not chosen a new password yet. */
export const inRecovery = () => recovering;
export const endRecovery = () => { recovering = false; };

/** Where account emails send people back to. */
export const accountUrl = () => (typeof window !== "undefined" ? `${window.location.origin}/account` : "/account");

/** Plain-language versions of the auth service's error messages. */
export function authMessage(e: { message?: string; status?: number; code?: string } | null | undefined): string {
  const m = e?.message || "Something went wrong.";
  if (/invalid login credentials/i.test(m)) return "That email and password don't match an account. Check both, or reset your password.";
  if (/email not confirmed/i.test(m)) return "This account's email address hasn't been confirmed yet.";
  if (/already registered|already been registered|user_already_exists/i.test(m) || e?.code === "user_already_exists") return "An account with this email already exists. Sign in instead, or reset the password if you've forgotten it.";
  if (/rate limit|too many/i.test(m) || e?.status === 429) return "Too many attempts or emails just now. Wait a few minutes and try again.";
  if (/should be different/i.test(m)) return "Choose a password that's different from your current one.";
  if (/password should be at least/i.test(m)) return "The password needs to be at least 8 characters.";
  if (/weak|pwned|leaked/i.test(m)) return "That password is too easy to guess or has appeared in a data breach. Choose a different one.";
  if (/reauthenticat/i.test(m)) return "For security, confirm your current password first.";
  if (/unable to validate email|invalid.*email/i.test(m)) return "That doesn't look like a valid email address.";
  if (/failed to fetch|network/i.test(m)) return "Couldn't reach the account service. Check your connection and try again.";
  if (/session.*(missing|expired)|jwt expired/i.test(m)) return "Your sign-in has expired. Sign in again.";
  return m;
}

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
