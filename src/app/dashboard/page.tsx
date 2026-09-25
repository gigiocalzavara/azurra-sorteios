import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import styles from "./dashboard.module.css";

export default async function DashboardPage() {
  const supabase = await createClient();
  const [{ data: promotions }, { data: orders }, { data: auth }] = await Promise.all([
    supabase.from("promotions").select("id,name,status,quota_quantity,created_at").order("created_at", { ascending: false }),
    supabase.from("orders").select("status,total_amount,quota_count"),
    supabase.auth.getUser()
  ]);

  const paidOrders = orders?.filter((item) => item.status === "paid") ?? [];
  const soldQuotas = paidOrders.reduce((sum, item) => sum + item.quota_count, 0);
  const confirmedAmount = paidOrders.reduce((sum, item) => sum + Number(item.total_amount), 0);
  const userName = (auth.user?.email ?? "usuário").split("@")[0];

  return (
    <main className={styles.main}>
      <section className={styles.welcome}>
        <h1>👋 Olá, <strong>{userName}</strong>!</h1>
      </section>

      <section className={styles.heroBanner}>
        <h2>Crie, publique e acompanhe seus sorteios em um só lugar.</h2>
        <p>A Azurra mantém sua operação organizada, da campanha à comunicação com o vencedor.</p>
      </section>

      <section className={styles.quickActions}>
        <Link className={styles.quickButton} href="/dashboard/promocoes/nova"><span>▣</span> CRIAR CAMPANHA</Link>
        <Link className={styles.quickButton} href="/dashboard/comunicacao"><span>◌</span> COMUNICAÇÃO</Link>
      </section>

      <h2 className={styles.sectionTitle}><span>▣</span> Minhas campanhas</h2>
      <p className={styles.sectionSubtitle}>Aqui estão suas campanhas criadas.</p>
      <select className={styles.filterBar} defaultValue="todas" aria-label="Filtrar campanhas">
        <option value="todas">Todas as campanhas</option>
        <option value="andamento">Em andamento</option>
        <option value="rascunho">Rascunhos</option>
        <option value="finalizadas">Finalizadas</option>
      </select>

      <section className={styles.stats}>
        <article className={styles.stat}><span>Campanhas</span><strong>{promotions?.length ?? 0}</strong></article>
        <article className={styles.stat}><span>Cotas vendidas</span><strong>{soldQuotas.toLocaleString("pt-BR")}</strong></article>
        <article className={styles.stat}><span>Pedidos pagos</span><strong>{paidOrders.length.toLocaleString("pt-BR")}</strong></article>
        <article className={styles.stat}><span>Valor confirmado</span><strong>{confirmedAmount.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</strong></article>
      </section>

      <section className={styles.panel}>
        {!promotions?.length ? (
          <div className={styles.empty}>Você ainda não criou nenhuma campanha.</div>
        ) : (
          <div className={styles.recentList}>
            {promotions.slice(0, 8).map((promotion) => (
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
