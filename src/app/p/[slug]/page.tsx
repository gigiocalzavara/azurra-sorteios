import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PurchaseForm from "./purchase-form";
import styles from "./public.module.css";

export default async function PublicPromotionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: promotion } = await supabase.from("promotions")
    .select("id,name,description,special_condition,product_image_url,quota_quantity,quota_price,minimum_per_order,maximum_per_order,status,organization_id,organizations(name,logo_url,primary_color,pix_key,pix_receiver_name,pix_receiver_city)")
    .eq("slug", slug).single();
  if (!promotion) notFound();
  const { count: unavailable = 0 } = await supabase.from("quotas").select("id", { count: "exact", head: true }).eq("promotion_id", promotion.id).neq("status", "available");
  const sold = unavailable || 0;
  const available = Math.max(0, promotion.quota_quantity - sold);
  const progress = Math.min(100, Math.round((sold / promotion.quota_quantity) * 100));
  const organization = Array.isArray(promotion.organizations) ? promotion.organizations[0] : promotion.organizations;
  return <main className={styles.page}>
    <header className={styles.brand} style={{ background: organization?.primary_color || undefined }}>{organization?.name || "Promoção"}</header>
    <div className={styles.shell}><div className={styles.grid}>
      <article className={styles.product}>
        {promotion.product_image_url ? <img className={styles.image} src={promotion.product_image_url} alt={promotion.name} /> : null}
        <div className={styles.details}><h1>{promotion.name}</h1><p>{promotion.description}</p>
          {promotion.special_condition ? <div className={styles.condition}><strong>Condição especial</strong><br />{promotion.special_condition}</div> : null}
          <div className={styles.progressLabel}><span>{progress}% reservado/vendido</span><span>{available} disponíveis</span></div>
          <div className={styles.progress}><div style={{ width: `${progress}%` }} /></div>
        </div>
      </article>
      <aside className={styles.purchase}><h2>Escolha suas cotas</h2><div className={styles.price}>{Number(promotion.quota_price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por cota</div>
        <PurchaseForm promotionId={promotion.id} price={Number(promotion.quota_price)} minimum={promotion.minimum_per_order} maximum={promotion.maximum_per_order} available={available} pixKey={organization?.pix_key || null} receiverName={organization?.pix_receiver_name || null} receiverCity={organization?.pix_receiver_city || null} />
      </aside>
    </div></div>
  </main>;
}
