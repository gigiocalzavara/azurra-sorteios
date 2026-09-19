# Azurra Sorteios

Plataforma web para gestão de promoções com cotas numeradas, reservas, pagamentos via PIX, comunicação por WhatsApp e operação de sorteios.

## Visão geral

O projeto concentra o fluxo da promoção em uma única aplicação: publicação da campanha, venda e reserva de cotas, acompanhamento de pagamentos, comunicação com participantes, registro do sorteio e operação pós-sorteio.

A aplicação principal é construída com Next.js e utiliza Supabase como camada de dados e autenticação. As integrações com WhatsApp rodam em serviços separados para isolar sessões e reduzir o impacto de falhas de conexão sobre a aplicação web.

## Stack

- Next.js 15
- React 19
- TypeScript
- Supabase / PostgreSQL
- Node.js
- Express
- Baileys
- Docker / Docker Swarm
- Traefik
- GitHub Actions
- GitHub Container Registry

## Serviços

### Aplicação web

Responsável pelo painel administrativo, páginas públicas das promoções, APIs da aplicação, autenticação e integração com o Supabase.

### WhatsApp Gateway

Mantém as sessões operacionais do WhatsApp, envia comunicações automáticas, processa respostas do vencedor e executa a fila de comunicação.

As credenciais de sessão são persistidas em volume Docker para permitir recuperação após reinicializações do container.

### Lead Capture Gateway

Serviço separado para leitura de grupos e captura de contatos. A separação evita misturar a sessão utilizada na operação das promoções com a sessão dedicada à captura.

## Infraestrutura

Os serviços são publicados como imagens Docker no GHCR e executados em Docker Swarm. O Traefik é responsável pelo roteamento HTTPS da aplicação pública.

A stack utiliza volumes persistentes para as sessões dos gateways e variáveis de ambiente para credenciais e configurações sensíveis.

## Desenvolvimento

Instale as dependências e execute o ambiente local:

```bash
npm install
npm run dev
```

Validação:

```bash
npm run typecheck
npm run build
```

As migrations do banco ficam em `supabase/migrations` e devem ser aplicadas na ordem em que foram versionadas.

## Configuração

Use `.env.example` como referência. Chaves, tokens e credenciais reais não devem ser versionados no repositório.

## Status

Projeto em evolução contínua, com foco atual em estabilidade das comunicações por WhatsApp e melhoria da experiência operacional.
