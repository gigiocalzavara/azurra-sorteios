"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  specialCondition: z.string().trim().max(3000).optional(),
  quotaQuantity: z.coerce.number().int().min(1).max(100000),
  quotaPrice: z.coerce.number().positive().max(999999),
  minimumPerOrder: z.coerce.number().int().min(1).max(100000),
  reservationMinutes: z.coerce.number().int().min(5).max(1440)
});

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createPromotion(formData: FormData) {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    specialCondition: formData.get("specialCondition") || undefined,
    quotaQuantity: formData.get("quotaQuantity"),
    quotaPrice: formData.get("quotaPrice"),
    minimumPerOrder: formData.get("minimumPerOrder"),
    reservationMinutes: formData.get("reservationMinutes")
  });

  if (!parsed.success) {
    redirect("/dashboard/promocoes/nova?error=Revise%20os%20campos%20informados");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    redirect("/dashboard/promocoes/nova?error=Usuário%20sem%20organização");
  }

  const baseSlug = slugify(parsed.data.name);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  const { error } = await supabase.from("promotions").insert({
    organization_id: membership.organization_id,
    name: parsed.data.name,
    slug,
    description: parsed.data.description,
    special_condition: parsed.data.specialCondition || null,
    quota_quantity: parsed.data.quotaQuantity,
    quota_price: parsed.data.quotaPrice,
    minimum_per_order: parsed.data.minimumPerOrder,
    reservation_minutes: parsed.data.reservationMinutes,
    created_by: authData.user.id
  });

  if (error) {
    console.error("createPromotion", error);
    redirect("/dashboard/promocoes/nova?error=Não%20foi%20possível%20salvar");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/promocoes");
  redirect("/dashboard/promocoes?created=1");
}
