"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
const MAX=5*1024*1024,types:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
const schema=z.object({name:z.string().trim().min(2).max(120),description:z.string().trim().min(3).max(3000),price:z.coerce.number().min(0).max(999999)});
export async function createProduct(formData:FormData){
 const parsed=schema.safeParse({name:formData.get("name"),description:formData.get("description"),price:formData.get("price")});if(!parsed.success)redirect("/dashboard/produtos?error=Revise%20os%20campos");
 const image=formData.get("image");if(!(image instanceof File)||!image.size||!types[image.type]||image.size>MAX)redirect("/dashboard/produtos?error=Envie%20uma%20imagem%20JPG%2C%20PNG%20ou%20WEBP%20de%20at%C3%A9%205MB");
 const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login");
 const {data:membership}=await supabase.from("organization_members").select("organization_id").eq("user_id",user.id).limit(1).maybeSingle();if(!membership)redirect("/dashboard/produtos?error=Usu%C3%A1rio%20sem%20organiza%C3%A7%C3%A3o");
 const id=crypto.randomUUID(),path=`${membership.organization_id}/${id}.${types[image.type]}`;const {error:up}=await supabase.storage.from("product-images").upload(path,image,{contentType:image.type,upsert:false});if(up)redirect("/dashboard/produtos?error=Falha%20ao%20enviar%20imagem");
 const url=supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;const {error}=await supabase.from("products").insert({id,organization_id:membership.organization_id,name:parsed.data.name,description:parsed.data.description,price:parsed.data.price,image_url:url});if(error){await supabase.storage.from("product-images").remove([path]);redirect("/dashboard/produtos?error=Falha%20ao%20salvar%20produto")}
 revalidatePath("/dashboard/produtos");redirect("/dashboard/produtos?created=1");
}
