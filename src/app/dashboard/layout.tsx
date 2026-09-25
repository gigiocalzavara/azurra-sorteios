import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

const navItems = [
  ["▣", "Campanhas", "/dashboard/promocoes"],
  ["◎", "Visão geral", "/dashboard"],
  ["◫", "Reservas e pagamentos", "/dashboard/pagamentos"],
  ["▤", "Relatórios", "/dashboard/relatorios"],
  ["◍", "Participantes", "/dashboard/participantes"],
  ["◇", "Produtos", "/dashboard/produtos"],
  ["◉", "Sorteios", "/dashboard/sorteios"],
  ["◌", "Comunicação", "/dashboard/comunicacao"],
  ["⌁", "Captura de leads", "/dashboard/captura-leads"],
  ["□", "Página pública", "/dashboard/pagina-publica"],
  ["⚙", "Configurações", "/dashboard/configuracoes"]
] as const;

function Navigation() {
  return (
    <nav className={styles.nav}>
      {navItems.map(([icon, label, href]) => (
        <Link href={href} key={href}>
          <span className={styles.navIcon}>{icon}</span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const email = data.user.email ?? "";
  const userLabel = email.split("@")[0] || "Conta";
  const initial = userLabel.charAt(0).toUpperCase();

  return (
    <div className={styles.frame}>
      <aside className={styles.sidebar}>
        <Link href="/dashboard" className={styles.logo}>AZURRA <span>SORTEIOS</span></Link>
        <Navigation />
        <form className={styles.logout} action={logout}>
          <button type="submit"><span>↪</span> Sair</button>
        </form>
      </aside>

      <section className={styles.content}>
        <header className={styles.topbar}>
          <details className={styles.mobileMenu}>
            <summary aria-label="Abrir menu"><span></span><span></span><span></span></summary>
            <div className={styles.mobileDrawer}>
              <div className={styles.mobileDrawerHead}>
                <strong>AZURRA <span>SORTEIOS</span></strong>
              </div>
              <Navigation />
              <form className={styles.logout} action={logout}><button type="submit">↪ Sair</button></form>
            </div>
          </details>

          <Link href="/dashboard" className={styles.mobileLogo}>AZURRA <span>SORTEIOS</span></Link>

          <div className={styles.topbarTools}>
            <span className={styles.notification} aria-hidden="true">♧</span>
            <div className={styles.avatar} title={email}>{initial}</div>
            <div className={styles.desktopUser}>
              <strong>{userLabel}</strong>
              <span>{email}</span>
            </div>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}
