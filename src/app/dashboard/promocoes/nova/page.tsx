import Link from "next/link";
import styles from "../../dashboard.module.css";

export default function NewPromotionPage() {
  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Nova promoção</h1>
          <p>Cadastre o produto e configure a distribuição das cotas.</p>
        </div>
      </div>
      <form className={styles.form}>
        <section className={styles.section}>
          <h2>Informações da promoção</h2>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.full}`}>
              Nome da promoção
              <input name="name" placeholder="Ex.: Perfume exclusivo de agosto" required />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              Descrição
              <textarea name="description" placeholder="Apresente o produto e os detalhes da promoção" required />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              Condição especial
              <textarea name="specialCondition" placeholder="Campo opcional para regras ou informações adicionais" />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              Foto do produto
              <input type="file" name="productImage" accept="image/png,image/jpeg,image/webp" />
            </label>
          </div>
        </section>
        <section className={styles.section}>
          <h2>Cotas e pagamento</h2>
          <div className={styles.fields}>
            <label className={styles.field}>
              Quantidade de cotas
              <input type="number" name="quotaQuantity" min="1" placeholder="100" required />
            </label>
            <label className={styles.field}>
              Valor por cota
              <input type="number" name="quotaPrice" min="0.01" step="0.01" placeholder="10,00" required />
            </label>
            <label className={styles.field}>
              Mínimo por compra
              <input type="number" name="minimumPerOrder" min="1" defaultValue="1" required />
            </label>
            <label className={styles.field}>
              Reserva por
              <input type="number" name="reservationMinutes" min="5" defaultValue="30" required />
            </label>
          </div>
        </section>
        <div className={styles.actions}>
          <Link href="/dashboard/promocoes">Cancelar</Link>
          <button className={styles.primary} type="submit">Salvar promoção</button>
        </div>
      </form>
    </main>
  );
}
