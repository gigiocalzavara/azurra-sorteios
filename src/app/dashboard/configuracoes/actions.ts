"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";

function normalizePixKey(value:string,type:string){
 const key=value.trim();
 if(type==="phone"){const digits=key.replace(/\D/g,"");return `+${digits.startsWith("55")?digits:`55${digits}`}`}
 if(type==="cpf"||type==="cnpj")return key.replace(/\D/g,"");
 if(type==="email")return key.toLowerCase();
 return key.toLowerCase();
}

async function currentOrganization(){
 const supabase=await createClient();
 const {data:auth}=await supabase.auth.getUser();
 if(!auth.user)redirect("/login");
 const {data:member}=await supabase.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).limit(1).maybeSingle();
 if(!member)redirect("/dashboard/configuracoes?error=Organização não encontrada");
 return {supabase,member};
}

export async function saveSettings(formData:FormData){
 const {supabase,member}=await currentOrganization();
 const pixType=String(formData.get("pixKeyType")||"");
 const payload={
  name:String(formData.get("name")||"").trim(),
  pix_key:normalizePixKey(String(formData.get("pixKey")||""),pixType),
  pix_key_type:pixType,
  pix_receiver_name:String(formData.get("receiverName")||"").trim().toUpperCase(),
  pix_receiver_city:String(formData.get("receiverCity")||"").trim().toUpperCase(),
  primary_color:String(formData.get("primaryColor")||"#6900ff"),
  secondary_color:String(formData.get("secondaryColor")||"#00f0ff")
 };
 const {error}=await supabase.from("organizations").update(payload).eq("id",member.organization_id);
 if(error)redirect(`/dashboard/configuracoes?error=${encodeURIComponent(error.message)}`);
 revalidatePath("/dashboard/configuracoes");
 redirect("/dashboard/configuracoes?saved=1");
}

export async function addMember(formData:FormData){
 const {supabase,member}=await currentOrganization();
 const email=String(formData.get("email")||"").trim().toLowerCase();
 const role=String(formData.get("role")||"operator");
 if(!email)redirect("/dashboard/configuracoes?error=Informe o e-mail do usuário");
 const {error}=await supabase.rpc("add_org_member_by_email",{target_org:member.organization_id,target_email:email,target_role:role});
 if(error)redirect(`/dashboard/configuracoes?error=${encodeURIComponent(error.message)}`);
 revalidatePath("/dashboard/configuracoes");
 redirect("/dashboard/configuracoes?membersaved=1");
}

export async function updateMemberRole(formData:FormData){
 const {supabase,member}=await currentOrganization();
 const userId=String(formData.get("userId")||"");
 const role=String(formData.get("role")||"operator");
 const {error}=await supabase.rpc("update_org_member_role",{target_org:member.organization_id,target_user:userId,target_role:role});
 if(error)redirect(`/dashboard/configuracoes?error=${encodeURIComponent(error.message)}`);
 revalidatePath("/dashboard/configuracoes");
 redirect("/dashboard/configuracoes?membersaved=1");
}

export async function removeMember(formData:FormData){
 const {supabase,member}=await currentOrganization();
 const userId=String(formData.get("userId")||"");
 const {error}=await supabase.rpc("remove_org_member",{target_org:member.organization_id,target_user:userId});
 if(error)redirect(`/dashboard/configuracoes?error=${encodeURIComponent(error.message)}`);
 revalidatePath("/dashboard/configuracoes");
 redirect("/dashboard/configuracoes?memberremoved=1");
}
