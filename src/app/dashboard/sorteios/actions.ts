"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
export async function createTestScenario(){const {error}=await (await createClient()).rpc("create_test_scenario");if(error)redirect(`/dashboard/sorteios?error=${encodeURIComponent(error.message)}`);revalidatePath("/dashboard");revalidatePath("/dashboard/promocoes");revalidatePath("/dashboard/pagamentos");revalidatePath("/dashboard/pagina-publica");revalidatePath("/dashboard/sorteios");redirect("/dashboard/sorteios?test=1")}
