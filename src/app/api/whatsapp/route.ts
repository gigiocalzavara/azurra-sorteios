import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type GatewayResult = {
  response: unknown | null;
  error: string | null;
};

async function getOrganizationContext(org: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", auth.user.id)
    .eq("organization_id", org)
    .maybeSingle();

  return member ? supabase : null;
}

async function callGateway(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<GatewayResult> {
  const base = process.env.WHATSAPP_GATEWAY_URL;
  const token = process.env.WHATSAPP_GATEWAY_TOKEN;

  if (!base || !token) {
    return {
      response: null,
      error: "Conector do WhatsApp ainda não foi configurado na stack.",
    };
  }

  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        response: null,
        error: data.error || "Falha no conector",
      };
    }

    return {
      response: data,
      error: null,
    };
  } catch {
    return {
      response: null,
      error: "Serviço do WhatsApp indisponível.",
    };
  }
}

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") || "";
  const action = req.nextUrl.searchParams.get("action") || "status";

  if (!(await getOrganizationContext(org))) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const result = await callGateway(`/sessions/${org}/${action}`);

  return NextResponse.json(
    result.error ? { error: result.error } : result.response,
    { status: result.error ? 503 : 200 },
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const org = String(body.org || "");
  const supabase = await getOrganizationContext(org);

  if (!supabase) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  if (body.action === "select_group") {
    const { data: setting, error } = await supabase
      .from("promotion_communication_settings")
      .upsert(
        {
          promotion_id: body.promotionId,
          group_jid: body.groupId,
          group_name: body.groupName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "promotion_id" },
      )
      .select("mode")
      .single();

    if (!error && setting?.mode === "automatic") {
      await supabase
        .from("communication_events")
        .update({
          status: "pending",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("promotion_id", body.promotionId)
        .in("status", ["manual_required", "failed"]);

      void callGateway(`/sessions/${org}/process`, "POST");
    }

    return NextResponse.json(
      error ? { error: error.message } : { ok: true },
      { status: error ? 400 : 200 },
    );
  }

  if (body.action === "process") {
    const result = await callGateway(`/sessions/${org}/process`, "POST");
    return NextResponse.json(
      result.error ? { error: result.error } : result.response,
      { status: result.error ? 503 : 200 },
    );
  }

  if (body.action === "disconnect") {
    const result = await callGateway(`/sessions/${org}`, "DELETE");
    return NextResponse.json(
      result.error ? { error: result.error } : result.response,
      { status: result.error ? 503 : 200 },
    );
  }

  const result = await callGateway(`/sessions/${org}/connect`, "POST");

  return NextResponse.json(
    result.error ? { error: result.error } : result.response,
    { status: result.error ? 503 : 200 },
  );
}

export async function DELETE(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") || "";

  if (!(await getOrganizationContext(org))) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const result = await callGateway(`/sessions/${org}`, "DELETE");

  return NextResponse.json(
    result.error ? { error: result.error } : result.response,
    { status: result.error ? 503 : 200 },
  );
}
