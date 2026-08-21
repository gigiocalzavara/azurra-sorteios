import Link from "next/link";
import styles from "./dashboard.module.css";

const stats = [
  ["Promoções ativas", "0"],
  ["Cotas vendidas", "0"],
  ["Pagamentos pendentes", "0"],
  ["Valor confirmado", "R$ 0,00"]
];

export default function DashboardPage() {
  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Visão geral</h1>
          <p>Acompanhe a operação das promoções em um único lugar.</p>
        </div>
        <Link className={styles.primary} href="/dashboard/promocoes/nova">
          Criar promoção
        </Link>
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
        <div className={styles.empty}>
          Nenhuma promoção cadastrada. Crie a primeira para iniciar a operação.
        </div>
      </section>
    </main>
  );
}
