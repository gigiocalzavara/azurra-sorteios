import {notFound,redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import DrawExperience from "./draw-experience";

export default async function DrawPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const supabase=await createClient();const {data:auth}=await supabase.auth.getUser();if(!auth.user)redirect("/login");
 let {data:draw}=await supabase.from("draws").select("id,promotion_id,winning_quota_id,participant_snapshot,drawn_at").eq("id",id).maybeSingle();
 const promotionId=draw?.promotion_id||id;
 if(!draw){const existing=await supabase.from("draws").select("id,promotion_id,winning_quota_id,participant_snapshot,drawn_at").eq("promotion_id",id).maybeSingle();draw=existing.data}
 const [{data:promotion},{data:quota}]=await Promise.all([
  supabase.from("promotions").select("name,product_image_url,quota_quantity,organization_id,status").eq("id",promotionId).single(),
  draw?supabase.from("quotas").select("number").eq("id",draw.winning_quota_id).single():Promise.resolve({data:null})
 ]);
 if(!promotion||(!draw&&promotion.status!=="ready_to_draw"))notFound();
 const {data:organization}=await supabase.from("organizations").select("name,logo_url,primary_color,secondary_color").eq("id",promotion.organization_id).single();
 const participant=(draw?.participant_snapshot||{}) as {name?:string;result_url?:string};
 return <DrawExperience drawId={draw?.id||null} promotionId={promotionId} promotion={promotion.name} imageUrl={promotion.product_image_url} quotaQuantity={promotion.quota_quantity} winningNumber={quota?.number||null} winnerName={participant.name||null} resultUrl={participant.result_url||null} organization={organization?.name||"Sorteio"} logoUrl={organization?.logo_url} primaryColor={organization?.primary_color||"#6900ff"} secondaryColor={organization?.secondary_color||"#00f0ff"}/>;
}
