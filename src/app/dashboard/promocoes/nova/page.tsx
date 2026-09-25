import Link from "next/link";
import { createPromotion } from "./actions";
import { createClient } from "@/lib/supabase/server";
import styles from "../../dashboard.module.css";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function Page({ searchParams }: Props) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = user
    ? await supabase.from("organization_members").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle()
    : { data: null };
  const { data: products } = membership
    ? await supabase.from("products").select("id,name,price").eq("organization_id", membership.organization_id).eq("active", true).order("name")
    : { data: [] };

  return (
    <main className={styles.main}>
      <div className={styles.formIntro}>
        <h1>Criar campanha</h1>
        <p>Insira os dados de como deseja a sua campanha. Você poderá ajustar as configurações depois.</p>
      </div>

      <div className={styles.helpPills}>
        <span className={styles.helpPill}>▶ Aprenda como criar</span>
        <span className={styles.helpPill}>? Preciso de ajuda</span>
      </div>

      {error ? <div className={styles.alertError}>{error}</div> : null}

      <form className={styles.form} action={createPromotion}>
        <section className={styles.section}>
          <h2>Dados da campanha</h2>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.full}`}>
              Nome da campanha
              <input name="name" required placeholder="Digite o nome da sua campanha" />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              Descrição
              <textarea name="description" required placeholder="Apresente a campanha e explique como participar" />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              Imagem da campanha
              <input type="file" name="campaignImage" accept="image/png,image/jpeg,image/webp" required />
              <small>JPG, PNG ou WEBP, com até 5 MB.</small>
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Quantidade e valor das cotas</h2>
          <div className={styles.fields}>
            <label className={styles.field}>
              Quantidade de cotas
              <input type="number" name="quotaQuantity" min="1" max="100000" required placeholder="Ex.: 100" />
            </label>
            <label className={styles.field}>
              Valor da cota
              <input type="number" name="quotaPrice" min="0.01" step="0.01" required placeholder="0,00" />
            </label>
            <label className={styles.field}>
              Mínimo por compra
              <input type="number" name="minimumPerOrder" min="1" defaultValue="1" required />
            </label>
            <label className={styles.field}>
              Limite por participante <small>Opcional</small>
              <input type="number" name="maximumPerParticipant" min="1" placeholder="Sem limite" />
            </label>
            <label className={styles.field}>
              Reserva em minutos
              <input type="number" name="reservationMinutes" min="5" max="1440" defaultValue="30" required />
            </label>
            <label className={styles.field}>
              PIX alternativo pós-sorteio
              <input type="number" name="postDrawPixAmount" min="0" step="0.01" required placeholder="0,00" />
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Produtos</h2>
          <p>Selecione um ou mais produtos que o vencedor poderá escolher.</p>
          <div className={styles.fields}>
            {(products || []).length ? (products || []).map((p: any) => (
              <label className={styles.field} key={p.id} style={{display:"flex",flexDirection:"row",alignItems:"center",gap:10}}>
                <input type="checkbox" name="productIds" value={p.id} />
                <span>{p.name} — {Number(p.price).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</span>
              </label>
            )) : <div className={styles.alertError}>Cadastre pelo menos um produto antes de criar a campanha.</div>}
          </div>
        </section>

        <aside className={styles.summaryCard}>
          <h3>Resumo da publicação</h3>
          <div className={styles.summaryLine}><span>Publicação</span><strong>Sem taxa fixa na Azurra</strong></div>
          <div className={styles.summaryLine}><span>Configuração</span><strong>Você poderá editar depois</strong></div>
        </aside>

        <div className={styles.actions}>
          <Link href="/dashboard/promocoes">Cancelar</Link>
          <button className={styles.primary} type="submit" disabled={!(products || []).length}>Prosseguir</button>
        </div>
      </form>
    </main>
  );
}
