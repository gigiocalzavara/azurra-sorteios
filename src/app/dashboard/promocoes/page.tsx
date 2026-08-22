import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import styles from "../dashboard.module.css";

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  published: "Publicada",
  sold_out: "Esgotada",
  ready_to_draw: "Pronta para sortear",
  drawn: "Sorteada",
  cancelled: "Cancelada"
};

type PromotionsPageProps = {
  searchParams: Promise<{ created?: string }>;
};

export default async function PromotionsPage({ searchParams }: PromotionsPageProps) {
  const { created } = await searchParams;
  const supabase = await createClient();
  const { data: promotions } = await supabase
    .from("promotions")
    .select("id,name,slug,status,quota_quantity,quota_price,created_at")
    .order("created_at", { ascending: false });

  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Promoções</h1>
          <p>Gerencie produtos, cotas, progresso e publicação.</p>
        </div>
        <Link className={styles.primary} href="/dashboard/promocoes/nova">Nova promoção</Link>
      </div>
      {created ? <div className={styles.alertSuccess}>Promoção criada com sucesso.</div> : null}
      <section className={styles.panel}>
        {!promotions?.length ? (
          <div className={styles.empty}>Nenhuma promoção cadastrada.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Promoção</th>
                  <th>Status</th>
                  <th>Cotas</th>
                  <th>Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((promotion) => (
                  <tr key={promotion.id}>
                    <td><strong>{promotion.name}</strong></td>
                    <td><span className={styles.status}>{statusLabels[promotion.status] ?? promotion.status}</span></td>
                    <td>{promotion.quota_quantity.toLocaleString("pt-BR")}</td>
                    <td>{Number(promotion.quota_price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                    <td><Link href={`/dashboard/promocoes/${promotion.id}`}>Abrir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
