import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import styles from "./dashboard.module.css";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: promotions }, { data: orders }] = await Promise.all([
    supabase
      .from("promotions")
      .select("id,name,status,quota_quantity,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("status,total_amount,quota_count")
  ]);

  const activePromotions = promotions?.filter((item) =>
    ["published", "sold_out", "ready_to_draw"].includes(item.status)
  ).length ?? 0;
  const soldQuotas = orders
    ?.filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + item.quota_count, 0) ?? 0;
  const pendingPayments = orders
    ?.filter((item) => ["pending", "payment_reported"].includes(item.status)).length ?? 0;
  const confirmedAmount = orders
    ?.filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + Number(item.total_amount), 0) ?? 0;

  const stats = [
    ["Promoções ativas", activePromotions.toLocaleString("pt-BR")],
    ["Cotas vendidas", soldQuotas.toLocaleString("pt-BR")],
    ["Pagamentos pendentes", pendingPayments.toLocaleString("pt-BR")],
    ["Valor confirmado", confirmedAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })]
  ];

  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Visão geral</h1>
          <p>Acompanhe a operação das promoções em um único lugar.</p>
        </div>
        <Link className={styles.primary} href="/dashboard/promocoes/nova">Criar promoção</Link>
      </div>
      <section className={styles.stats}>
        {stats.map(([label, value]) => (
          <article className={styles.stat} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className={styles.panel}>
        <strong>Promoções recentes</strong>
        {!promotions?.length ? (
          <div className={styles.empty}>Nenhuma promoção cadastrada.</div>
        ) : (
          <div className={styles.recentList}>
            {promotions.slice(0, 5).map((promotion) => (
              <Link key={promotion.id} href={`/dashboard/promocoes/${promotion.id}`}>
                <strong>{promotion.name}</strong>
                <span>{promotion.quota_quantity.toLocaleString("pt-BR")} cotas</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
