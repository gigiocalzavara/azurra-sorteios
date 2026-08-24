"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
export async function performDraw(formData:FormData){const id=String(formData.get("id")||"");const {data,error}=await (await createClient()).rpc("perform_promotion_draw",{target_promotion_id:id});if(error)redirect(`/dashboard/sorteios?error=${encodeURIComponent(error.message)}`);revalidatePath("/dashboard/sorteios");redirect(`/dashboard/sorteios?draw=${encodeURIComponent(JSON.stringify(data))}`)}
export async function createTestScenario(){const {error}=await (await createClient()).rpc("create_test_scenario");if(error)redirect(`/dashboard/sorteios?error=${encodeURIComponent(error.message)}`);revalidatePath("/dashboard");revalidatePath("/dashboard/promocoes");revalidatePath("/dashboard/pagamentos");revalidatePath("/dashboard/pagina-publica");revalidatePath("/dashboard/sorteios");redirect("/dashboard/sorteios?test=1")}
