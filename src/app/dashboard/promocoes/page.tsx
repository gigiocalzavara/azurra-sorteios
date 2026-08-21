import Link from "next/link";
import styles from "../dashboard.module.css";

export default function PromotionsPage() {
  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Promoções</h1>
          <p>Gerencie produtos, cotas, progresso e publicação.</p>
        </div>
        <Link className={styles.primary} href="/dashboard/promocoes/nova">Nova promoção</Link>
      </div>
      <section className={styles.panel}>
        <div className={styles.empty}>Nenhuma promoção cadastrada.</div>
      </section>
    </main>
  );
}
