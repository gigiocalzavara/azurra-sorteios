import Link from "next/link";

const features=[
  ["Campanhas","Crie campanhas, defina cotas, produtos e regras em um fluxo simples."],
  ["Pagamentos PIX","Acompanhe reservas e confirme pagamentos sem perder o histórico."],
  ["Sorteio auditável","Registre o resultado com rastreabilidade e comunicação integrada."],
  ["Página pública","Venda cotas em uma experiência simples e otimizada para celular."],
  ["WhatsApp","Automatize os principais momentos da campanha e o pós-sorteio."],
  ["Operação organizada","Centralize participantes, comunicação, produtos e configurações."]
];

export default function Home(){
  return <main>
    <header className="landingHeader">
      <div className="shell landingNav">
        <Link href="/" className="landingLogo">AZURRA <span>SORTEIOS</span></Link>
        <Link href="/login" className="loginButton">Entrar</Link>
      </div>
    </header>

    <section className="shell hero">
      <span className="badge">AZURRA SORTEIOS</span>
      <p className="eyebrow">Gestão de campanhas</p>
      <h1>Do lançamento ao sorteio, tudo em um único fluxo.</h1>
      <p className="lead">Uma plataforma para organizar campanhas, cotas, pagamentos, participantes, WhatsApp e sorteios com uma operação simples no computador e no celular.</p>
      <div className="heroActions">
        <Link href="/login" className="heroPrimary">Acessar painel</Link>
      </div>
    </section>

    <section className="shell grid">
      {features.map(([title,description])=><article className="card" key={title}><strong>{title}</strong><p>{description}</p></article>)}
    </section>
  </main>
}