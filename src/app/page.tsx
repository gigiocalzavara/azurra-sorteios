const features = [
  ["Promoções", "Cadastre produtos, condições, quantidade e valor das cotas em um painel simples."],
  ["Pagamentos PIX", "Controle reservas, comprovantes e confirmações antes de validar cada participação."],
  ["Sorteio auditável", "Feche a promoção, bloqueie alterações e registre o resultado com rastreabilidade."],
  ["Página pública", "Apresente cada promoção com a identidade visual do cliente, sem marca Azurra."],
  ["WhatsApp", "Dispare eventos da promoção e integre participantes ao ecossistema Azurra Leads."],
  ["Operação segura", "Separe cotas disponíveis, reservadas, pagas, expiradas e canceladas."]
];

export default function Home() {
  return (
    <main>
      <section className="shell hero">
        <span className="badge">Fundação do projeto ativa</span>
        <p className="eyebrow">Azurra Sorteios</p>
        <h1>Promoções organizadas do primeiro PIX ao resultado.</h1>
        <p className="lead">
          Uma plataforma privada para controlar cotas, pagamentos, participantes,
          comunicações e sorteios em uma única operação.
        </p>
      </section>
      <section className="shell grid">
        {features.map(([title, description]) => (
          <article className="card" key={title}>
            <strong>{title}</strong>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
