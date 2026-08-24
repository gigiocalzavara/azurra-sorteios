"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
export async function performDraw(formData:FormData){const id=String(formData.get("id")||"");const {data,error}=await (await createClient()).rpc("perform_promotion_draw",{target_promotion_id:id});if(error)redirect(`/dashboard/sorteios?error=${encodeURIComponent(error.message)}`);revalidatePath("/dashboard/sorteios");redirect(`/dashboard/sorteios?draw=${encodeURIComponent(JSON.stringify(data))}`)}
