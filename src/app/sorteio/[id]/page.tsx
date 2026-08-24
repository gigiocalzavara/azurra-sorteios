import {notFound,redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import DrawExperience from "./draw-experience";

export default async function DrawPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const supabase=await createClient();
  const {data:auth}=await supabase.auth.getUser();
  if(!auth.user) redirect("/login");
  const {data:draw}=await supabase.from("draws").select("id,promotion_id,winning_quota_id,participant_snapshot,drawn_at").eq("id",id).maybeSingle();
  if(!draw) notFound();
  const [{data:promotion},{data:quota}]=await Promise.all([
    supabase.from("promotions").select("name,product_image_url,quota_quantity,organization_id").eq("id",draw.promotion_id).single(),
    supabase.from("quotas").select("number").eq("id",draw.winning_quota_id).single()
  ]);
  if(!promotion||!quota) notFound();
  const {data:organization}=await supabase.from("organizations").select("name,logo_url,primary_color,secondary_color").eq("id",promotion.organization_id).single();
  const participant=draw.participant_snapshot as {name?:string;phone?:string};
  return <DrawExperience drawId={draw.id} promotionId={draw.promotion_id} promotion={promotion.name} imageUrl={promotion.product_image_url} quotaQuantity={promotion.quota_quantity} winningNumber={quota.number} winnerName={participant.name||"Participante"} organization={organization?.name||"Sorteio"} logoUrl={organization?.logo_url} primaryColor={organization?.primary_color||"#6900ff"} secondaryColor={organization?.secondary_color||"#00f0ff"}/>;
}
