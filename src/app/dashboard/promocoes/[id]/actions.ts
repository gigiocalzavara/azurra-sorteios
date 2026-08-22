"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
export async function publishPromotion(formData:FormData){const id=String(formData.get("id")||"");const supabase=await createClient();const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");const {error}=await supabase.from("promotions").update({status:"published",published_at:new Date().toISOString()}).eq("id",id).eq("status","draft");if(error)redirect(`/dashboard/promocoes/${id}?error=${encodeURIComponent(error.message)}`);revalidatePath(`/dashboard/promocoes/${id}`);revalidatePath("/dashboard/promocoes")}
