import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/login");

  return (
    <div className={styles.frame}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>azurra<span>.</span>sorteios</div>
        <nav className={styles.nav}>
          <Link href="/dashboard">Visão geral</Link>
          <Link href="/dashboard/promocoes">Promoções</Link>
          <Link href="/dashboard/pagina-publica">Página pública</Link>
          <Link href="/dashboard/pagamentos">Pagamentos</Link>
          <Link href="/dashboard/participantes">Participantes</Link>
          <Link href="/dashboard/captura-leads">Captura de leads</Link>
          <Link href="/dashboard/sorteios">Sorteios</Link>
          <Link href="/dashboard/comunicacao">Comunicação</Link>
          <Link href="/dashboard/configuracoes">Configurações</Link>
        </nav>
        <form className={styles.logout} action={logout}>
          <button type="submit">Sair do painel</button>
        </form>
      </aside>
      <section className={styles.content}>
        <header className={styles.topbar}>
          <strong>Painel administrativo</strong>
          <span className={styles.user}>{data.user.email}</span>
        </header>
        {children}
      </section>
    </div>
  );
}
