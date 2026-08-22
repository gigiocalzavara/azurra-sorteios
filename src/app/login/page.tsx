import styles from "./login.module.css";
import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <main className={styles.page}>
      <section className={styles.brand}>
        <div className={styles.logo}>azurra<span>.</span>sorteios</div>
        <div>
          <h1>Controle completo da promoção ao resultado.</h1>
          <p>Gestão de cotas, pagamentos, participantes e sorteios.</p>
        </div>
      </section>
      <section className={styles.panel}>
        <form className={styles.form} action={login}>
          <h2>Acesse o painel</h2>
          <p>Entre com os dados cadastrados para sua operação.</p>
          {error ? <p className={styles.error}>{error}</p> : null}
          <label className={styles.field}>
            E-mail
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label className={styles.field}>
            Senha
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button className={styles.button} type="submit">Entrar</button>
        </form>
      </section>
    </main>
  );
}
