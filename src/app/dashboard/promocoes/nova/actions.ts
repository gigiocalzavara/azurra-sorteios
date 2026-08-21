"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const allowedImages: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

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

function fail(message: string): never {
  redirect(`/dashboard/promocoes/nova?error=${encodeURIComponent(message)}`);
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

  if (!parsed.success) fail("Revise os campos informados");

  const image = formData.get("productImage");
  if (!(image instanceof File) || image.size === 0) fail("Selecione a foto do produto");
  if (!allowedImages[image.type]) fail("Use uma imagem JPG, PNG ou WEBP");
  if (image.size > MAX_IMAGE_SIZE) fail("A imagem deve ter no máximo 5 MB");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) fail("Usuário sem organização");

  const promotionId = crypto.randomUUID();
  const extension = allowedImages[image.type];
  const imagePath = `${membership.organization_id}/${promotionId}/product.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("promotion-images")
    .upload(imagePath, image, {
      contentType: image.type,
      cacheControl: "3600",
      upsert: false
    });

  if (uploadError) {
    console.error("productImageUpload", uploadError.message);
    fail("Não foi possível enviar a foto do produto");
  }

  const { data: publicImage } = supabase.storage
    .from("promotion-images")
    .getPublicUrl(imagePath);

  const baseSlug = slugify(parsed.data.name);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  const { error } = await supabase.from("promotions").insert({
    id: promotionId,
    organization_id: membership.organization_id,
    name: parsed.data.name,
    slug,
    description: parsed.data.description,
    special_condition: parsed.data.specialCondition || null,
    product_image_url: publicImage.publicUrl,
    quota_quantity: parsed.data.quotaQuantity,
    quota_price: parsed.data.quotaPrice,
    minimum_per_order: parsed.data.minimumPerOrder,
    reservation_minutes: parsed.data.reservationMinutes,
    created_by: authData.user.id
  });

  if (error) {
    await supabase.storage.from("promotion-images").remove([imagePath]);
    console.error("createPromotion", error.message);
    fail("Não foi possível salvar a promoção");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/promocoes");
  redirect("/dashboard/promocoes?created=1");
}
