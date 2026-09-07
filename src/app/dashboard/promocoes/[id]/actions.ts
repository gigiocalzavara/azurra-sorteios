"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function getContext(id: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: promotion } = await supabase
    .from("promotions")
    .select("id,organization_id,status,name,description,campaign_image_url,quota_quantity,quota_price,post_draw_pix_amount,organizations(pix_key)")
    .eq("id", id)
    .maybeSingle();
  if (!promotion) redirect("/dashboard/promocoes");
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", auth.user.id)
    .eq("organization_id", promotion.organization_id)
    .maybeSingle();
  if (!member) redirect("/dashboard/promocoes");
  return { supabase, promotion };
}

export async function savePromotionCommunication(formData: FormData) {
  const id = String(formData.get("id") || "");
  const mode = String(formData.get("mode") || "automatic");
  if (!id || !["automatic", "approval", "manual"].includes(mode)) {
    redirect(`/dashboard/promocoes/${id}/configuracao?step=2&error=${encodeURIComponent("Modo de comunicação inválido")}`);
  }
  const { supabase } = await getContext(id);
  const { error } = await supabase.from("promotion_communication_settings").upsert(
    { promotion_id: id, mode, active: true, updated_at: new Date().toISOString() },
    { onConflict: "promotion_id" },
  );
  if (error) redirect(`/dashboard/promocoes/${id}/configuracao?step=2&error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/dashboard/promocoes/${id}/configuracao`);
  redirect(`/dashboard/promocoes/${id}/configuracao?step=3`);
}

export async function publishPromotion(formData: FormData) {
  const id = String(formData.get("id") || "");
  const { supabase, promotion } = await getContext(id);
  if (promotion.status !== "draft") redirect(`/dashboard/promocoes/${id}`);

  const [{ data: setting }, { count: productsCount }] = await Promise.all([
    supabase.from("promotion_communication_settings").select("mode,active,group_jid,group_name").eq("promotion_id", id).maybeSingle(),
    supabase.from("promotion_products").select("product_id", { count: "exact", head: true }).eq("promotion_id", id),
  ]);
  const org = Array.isArray(promotion.organizations) ? promotion.organizations[0] : promotion.organizations;
  const checks = [
    Boolean(promotion.name?.trim()),
    Boolean(promotion.description?.trim()),
    Boolean(promotion.campaign_image_url),
    Number(promotion.quota_quantity) > 0,
    Number(promotion.quota_price) > 0,
    (productsCount || 0) > 0,
    Boolean(org?.pix_key),
    Boolean(setting?.active),
    Boolean(setting?.group_jid),
    Boolean(setting?.mode),
  ];
  if (checks.some((ok) => !ok)) {
    redirect(`/dashboard/promocoes/${id}/configuracao?step=3&error=${encodeURIComponent("A promoção ainda tem itens pendentes. Revise o checklist antes de publicar.")}`);
  }

  const { error } = await supabase
    .from("promotions")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft");
  if (error) redirect(`/dashboard/promocoes/${id}/configuracao?step=3&error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/dashboard/promocoes/${id}`);
  revalidatePath(`/dashboard/promocoes/${id}/configuracao`);
  revalidatePath("/dashboard/promocoes");
  redirect(`/dashboard/promocoes/${id}?published=1`);
}
