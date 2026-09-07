"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const MAX = 5 * 1024 * 1024;
const types: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const schema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  quotaQuantity: z.coerce.number().int().min(1).max(100000),
  quotaPrice: z.coerce.number().positive(),
  minimumPerOrder: z.coerce.number().int().min(1),
  reservationMinutes: z.coerce.number().int().min(5).max(1440),
  maximumPerParticipant: z
    .union([z.coerce.number().int().min(1), z.literal("")])
    .optional(),
  postDrawPixAmount: z.coerce.number().min(0),
});

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const fail = (message: string): never =>
  redirect(`/dashboard/promocoes/nova?error=${encodeURIComponent(message)}`);

export async function createPromotion(formData: FormData) {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    quotaQuantity: formData.get("quotaQuantity"),
    quotaPrice: formData.get("quotaPrice"),
    minimumPerOrder: formData.get("minimumPerOrder"),
    reservationMinutes: formData.get("reservationMinutes"),
    maximumPerParticipant: formData.get("maximumPerParticipant") || "",
    postDrawPixAmount: formData.get("postDrawPixAmount"),
  });

  if (!parsed.success) {
    fail("Revise os campos informados");
  }
  const data = parsed.data;

  const productIds = formData.getAll("productIds").map(String).filter(Boolean);
  if (!productIds.length) {
    fail("Selecione pelo menos um produto");
  }

  const imageEntry = formData.get("campaignImage");
  if (!(imageEntry instanceof File) || imageEntry.size === 0) {
    fail("Selecione a foto da campanha");
  }
  const image = imageEntry;

  if (!types[image.type] || image.size > MAX) {
    fail("Use JPG, PNG ou WEBP de até 5 MB");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    fail("Usuário sem organização");
  }
  const organizationId = membership.organization_id;

  const { data: validProducts } = await supabase
    .from("products")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .in("id", productIds);

  if ((validProducts || []).length !== new Set(productIds).size) {
    fail("Há produtos inválidos na seleção");
  }

  const id = crypto.randomUUID();
  const path = `${organizationId}/${id}/campaign.${types[image.type]}`;

  const { error: uploadError } = await supabase.storage
    .from("promotion-images")
    .upload(path, image, {
      contentType: image.type,
      upsert: false,
    });

  if (uploadError) {
    fail("Não foi possível enviar a foto da campanha");
  }

  const url = supabase.storage.from("promotion-images").getPublicUrl(path).data
    .publicUrl;

  const { error } = await supabase.from("promotions").insert({
    id,
    organization_id: organizationId,
    name: data.name,
    slug: `${slugify(data.name)}-${Date.now().toString(36)}`,
    description: data.description,
    campaign_image_url: url,
    product_image_url: url,
    quota_quantity: data.quotaQuantity,
    quota_price: data.quotaPrice,
    minimum_per_order: data.minimumPerOrder,
    reservation_minutes: data.reservationMinutes,
    maximum_per_participant:
      data.maximumPerParticipant === "" ? null : data.maximumPerParticipant,
    post_draw_pix_amount: data.postDrawPixAmount,
    created_by: user.id,
  });

  if (error) {
    await supabase.storage.from("promotion-images").remove([path]);
    fail("Não foi possível salvar a promoção");
  }

  const links = productIds.map((product_id, index) => ({
    promotion_id: id,
    product_id,
    display_order: index + 1,
  }));

  const { error: linkError } = await supabase
    .from("promotion_products")
    .insert(links);

  if (linkError) {
    fail("Promoção criada, mas não foi possível vincular os produtos");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/promocoes");
  redirect("/dashboard/promocoes?created=1");
}
