"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
export async function confirmPayment(formData:FormData){const id=String(formData.get("id")||"");const {error}=await (await createClient()).rpc("confirm_order_payment",{target_order_id:id});if(error)redirect(`/dashboard/pagamentos?error=${encodeURIComponent(error.message)}`);revalidatePath("/dashboard");revalidatePath("/dashboard/pagamentos");revalidatePath("/dashboard/sorteios")}
