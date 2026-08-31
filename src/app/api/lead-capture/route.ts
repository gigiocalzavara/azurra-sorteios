import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Contact = { phone: string; name?: string | null };

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

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") || "";
  const action = req.nextUrl.searchParams.get("action") || "status";
  const ctx = await context(org);
  if (!ctx) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (action === "export") {
    const { data, error } = await ctx.supabase.from("captured_leads")
      .select("display_name,phone_e164,consent_status,first_captured_at,last_captured_at,captured_lead_sources(group_name)")
      .eq("organization_id", org).order("last_captured_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const lines = [["Nome", "WhatsApp", "Consentimento", "Grupos de origem", "Primeira captura", "Última captura"].map(csvCell).join(";")];
    for (const lead of data || []) {
      const groups = (lead.captured_lead_sources || []).map((source: { group_name: string }) => source.group_name).join(", ");
      lines.push([lead.display_name, lead.phone_e164, lead.consent_status, groups, lead.first_captured_at, lead.last_captured_at].map(csvCell).join(";"));
    }
    return new NextResponse("\uFEFF" + lines.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="leads-whatsapp.csv"' } });
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
  const normalized = [...new Map<string, { phone_e164: string; display_name: string | null }>(contacts.map((contact) => {
    const digits = String(contact.phone || "").replace(/\D/g, "");
    const phone = digits ? `+${digits}` : "";
    return [phone, { phone_e164: phone, display_name: contact.name?.trim() || null }] as const;
  }).filter(([phone]) => /^\+[1-9][0-9]{7,14}$/.test(phone))).values()];
  if (!groupId || !groupName || !normalized.length) return NextResponse.json({ error: "Nenhum contato válido selecionado" }, { status: 400 });
  const phones = normalized.map((contact) => contact.phone_e164);
  const { data: existing } = await ctx.supabase.from("captured_leads").select("phone_e164").eq("organization_id", org).in("phone_e164", phones);
  const existingPhones = new Set((existing || []).map((item) => item.phone_e164));
  const now = new Date().toISOString();
  const { data: run, error: runError } = await ctx.supabase.from("lead_capture_runs").insert({
    organization_id: org, group_jid: groupId, group_name: groupName, found_count: Number(body.foundCount) || normalized.length,
    imported_count: normalized.length, duplicate_count: existingPhones.size, created_by: ctx.user.id
  }).select("id").single();
  if (runError) return NextResponse.json({ error: runError.message }, { status: 400 });
  const { error: leadError } = await ctx.supabase.from("captured_leads").upsert(normalized.map((contact) => ({
    organization_id: org, ...contact, last_captured_at: now, created_by: ctx.user.id
  })), { onConflict: "organization_id,phone_e164" });
  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 400 });
  const { data: leads, error: readError } = await ctx.supabase.from("captured_leads").select("id,phone_e164").eq("organization_id", org).in("phone_e164", phones);
  if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
  const { error: sourceError } = await ctx.supabase.from("captured_lead_sources").upsert((leads || []).map((lead) => ({
    lead_id: lead.id, group_jid: groupId, group_name: groupName, last_captured_at: now, capture_run_id: run.id
  })), { onConflict: "lead_id,group_jid" });
  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 400 });
  return NextResponse.json({ ok: true, imported: normalized.length, new: normalized.length - existingPhones.size, duplicates: existingPhones.size });
}

export async function DELETE(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") || "";
  if (!await context(org)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const result = await gateway(`/sessions/${org}`, "DELETE");
  return NextResponse.json(result.error ? { error: result.error } : result.data, { status: result.error ? 503 : 200 });
}
