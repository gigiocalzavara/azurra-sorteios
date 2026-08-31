import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Contact = { phone?: string | null; username?: string | null; lid?: string | null; name?: string | null };
type NormalizedContact = {
  identity_key: string;
  identity_kind: "phone" | "username" | "lid";
  phone_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_lid: string | null;
  display_name: string | null;
};

async function context(org: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: member } = await supabase.from("organization_members").select("organization_id")
    .eq("user_id", auth.user.id).eq("organization_id", org).maybeSingle();
  return member ? { supabase, user: auth.user } : null;
}

async function gateway(path: string, method = "GET") {
  const base = process.env.LEAD_CAPTURE_GATEWAY_URL;
  const token = process.env.LEAD_CAPTURE_GATEWAY_TOKEN;
  if (!base || !token) return { data: null, error: "Extrator de contatos ainda não foi configurado na stack." };
  try {
    const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json();
    return response.ok ? { data, error: null } : { data: null, error: data.error || "Falha no extrator" };
  } catch { return { data: null, error: "Serviço de captura indisponível." }; }
}

const csvCell = (value: unknown, protect = true) => {
  const text = String(value ?? "");
  const safe = protect && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") || "";
  const action = req.nextUrl.searchParams.get("action") || "status";
  const ctx = await context(org);
  if (!ctx) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (action === "export_azurra") {
    const { data, error } = await ctx.supabase.from("captured_leads")
      .select("display_name,phone_e164,whatsapp_username,whatsapp_lid,consent_status,captured_lead_sources(group_name)")
      .eq("organization_id", org).not("phone_e164", "is", null).neq("identity_kind", "legacy_unverified")
      .order("last_captured_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const lines = [["nome", "telefone", "origem", "username", "whatsapp_lid", "consentimento"].map((value) => csvCell(value)).join(";")];
    for (const lead of data || []) {
      const groups = (lead.captured_lead_sources || []).map((source: { group_name: string }) => source.group_name).join(", ");
      const phoneDigits = String(lead.phone_e164 || "").replace(/\D/g, "");
      lines.push([csvCell(lead.display_name), csvCell(phoneDigits, false), csvCell(groups), csvCell(lead.whatsapp_username), csvCell(lead.whatsapp_lid), csvCell(lead.consent_status)].join(";"));
    }
    return new NextResponse("\uFEFF" + lines.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="azurra-leads-importacao.csv"' } });
  }
  const groupId = req.nextUrl.searchParams.get("groupId");
  const path = action === "participants" && groupId
    ? `/sessions/${org}/groups/${encodeURIComponent(groupId)}/participants`
    : `/sessions/${org}/${action}`;
  const result = await gateway(path);
  return NextResponse.json(result.error ? { error: result.error } : result.data, { status: result.error ? 503 : 200 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const org = String(body.org || "");
  const ctx = await context(org);
  if (!ctx) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (body.action === "connect") {
    const result = await gateway(`/sessions/${org}/connect`, "POST");
    return NextResponse.json(result.error ? { error: result.error } : result.data, { status: result.error ? 503 : 200 });
  }
  if (body.action !== "import") return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  const groupId = String(body.groupId || ""), groupName = String(body.groupName || "").trim();
  const contacts = (Array.isArray(body.contacts) ? body.contacts : []) as Contact[];
  const normalized = [...new Map<string, NormalizedContact>(contacts.map((contact) => {
    const digits = String(contact.phone || "").replace(/\D/g, "");
    const phone = /^\+[1-9][0-9]{7,14}$/.test(`+${digits}`) ? `+${digits}` : null;
    const lid = String(contact.lid || "").endsWith("@lid") ? String(contact.lid) : null;
    const usernameValue = String(contact.username || "").trim().replace(/^@/, "");
    const username = usernameValue ? `@${usernameValue}` : null;
    const identityKey = lid ? `lid:${lid}` : username ? `username:${username.toLowerCase()}` : phone ? `phone:${phone}` : "";
    const identityKind = lid ? "lid" : username ? "username" : "phone";
    return [identityKey, { identity_key: identityKey, identity_kind: identityKind, phone_e164: phone, whatsapp_username: username, whatsapp_lid: lid, display_name: contact.name?.trim() || null }] as const;
  }).filter(([identityKey]) => Boolean(identityKey))).values()];
  if (!groupId || !groupName || !normalized.length) return NextResponse.json({ error: "Nenhuma identidade válida selecionada" }, { status: 400 });
  const identityKeys = normalized.map((contact) => contact.identity_key);
  const { data: existing } = await ctx.supabase.from("captured_leads").select("identity_key").eq("organization_id", org).in("identity_key", identityKeys);
  const existingKeys = new Set((existing || []).map((item) => item.identity_key));
  const now = new Date().toISOString();
  const { data: run, error: runError } = await ctx.supabase.from("lead_capture_runs").insert({
    organization_id: org, group_jid: groupId, group_name: groupName, found_count: Number(body.foundCount) || normalized.length,
    imported_count: normalized.length, duplicate_count: existingKeys.size, created_by: ctx.user.id
  }).select("id").single();
  if (runError) return NextResponse.json({ error: runError.message }, { status: 400 });
  const { error: leadError } = await ctx.supabase.from("captured_leads").upsert(normalized.map((contact) => ({
    organization_id: org, ...contact, last_captured_at: now, created_by: ctx.user.id
  })), { onConflict: "organization_id,identity_key" });
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 400 });
  const { data: leads, error: readError } = await ctx.supabase.from("captured_leads").select("id,identity_key").eq("organization_id", org).in("identity_key", identityKeys);
  if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
  const { error: sourceError } = await ctx.supabase.from("captured_lead_sources").upsert((leads || []).map((lead) => ({
    lead_id: lead.id, group_jid: groupId, group_name: groupName, last_captured_at: now, capture_run_id: run.id
  })), { onConflict: "lead_id,group_jid" });
  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 400 });
  const azurraReady = normalized.filter((contact) => contact.phone_e164).length;
  return NextResponse.json({ ok: true, imported: normalized.length, new: normalized.length - existingKeys.size, duplicates: existingKeys.size, azurraReady, manual: normalized.length - azurraReady });
}

export async function DELETE(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") || "";
  if (!await context(org)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const result = await gateway(`/sessions/${org}`, "DELETE");
  return NextResponse.json(result.error ? { error: result.error } : result.data, { status: result.error ? 503 : 200 });
}
