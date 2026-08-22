import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { createClient } from "@/lib/supabase/server";
import { PurchaseForm } from "./purchase-form";
import styles from "./public-promotion.module.css";

export const dynamic = "force-dynamic";
type Props={params:Promise<{organizationSlug:string;promotionSlug:string}>};
type Promotion={name:string;description:string;special_condition:string|null;product_image_url:string|null;quota_quantity:number;quota_price:number;minimum_per_order:number;maximum_per_order:number|null;reservation_minutes:number;status:string;organization:{name:string;logo_url:string|null;primary_color:string;secondary_color:string};quotas:{available:number;reserved:number;paid:number}};

export default async function Page({params}:Props){
 const {organizationSlug,promotionSlug}=await params;
 const supabase=await createClient();
 const {data,error}=await supabase.rpc("get_public_promotion",{organization_slug:organizationSlug,promotion_slug:promotionSlug});
 if(error||!data) notFound();
 const p=data as Promotion;
 const progress=Math.min(100,Math.round(((p.quotas.paid+p.quotas.reserved)/p.quota_quantity)*100));
 const brand={"--brand":p.organization.primary_color||"#6900ff","--accent":p.organization.secondary_color||"#00f0ff"} as CSSProperties;
 return <main className={styles.page} style={brand}><div className={styles.shell}>
  <header className={styles.header}>{p.organization.logo_url?<img src={p.organization.logo_url} alt={p.organization.name}/>:null}<span>{p.organization.name}</span></header>
  <section className={styles.grid}>
   <div className={styles.product}>{p.product_image_url?<img src={p.product_image_url} alt={p.name}/>:<div>Imagem do prêmio</div>}</div>
   <div className={styles.content}><span className={styles.eyebrow}>Promoção ativa</span><h1>{p.name}</h1><p className={styles.description}>{p.description}</p>
    {p.special_condition?<div className={styles.condition}>{p.special_condition}</div>:null}
    <div className={styles.progressMeta}><span>{progress}% reservado</span><span>{p.quotas.available} disponíveis</span></div><div className={styles.progress}><i style={{width:`${progress}%`}}/></div>
    <PurchaseForm organizationSlug={organizationSlug} promotionSlug={promotionSlug} quotaPrice={Number(p.quota_price)} minimum={p.minimum_per_order} maximum={Math.min(p.maximum_per_order??p.quotas.available,p.quotas.available)} reservationMinutes={p.reservation_minutes} disabled={p.status!=="published"||p.quotas.available<p.minimum_per_order}/>
   </div>
  </section><footer className={styles.footer}>Pagamento por PIX • Cotas atribuídas aleatoriamente</footer>
 </div></main>;
}
