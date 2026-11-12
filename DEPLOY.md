# Roteiro de publicação das correções (itens 1–29)

Siga na ordem. Cada etapa diz **onde** fazer: terminal (na pasta do projeto),
**SQL Editor** do Supabase, ou **painel** do Supabase/Netlify.

> ⚠️ **Nunca rode `supabase db push` sem fazer a Etapa 2.** A primeira migração do
> projeto (`20260918195815_create_secretaria_schema.sql`) começa com
> `DROP TABLE ... studios, clients, appointments CASCADE`. Se o Supabase achar que
> ela ainda não rodou, ele roda de novo e **apaga todos os dados**.

---

## Etapa 0 — Preparação (5 min)

- [ ] Escolha um horário de pouco movimento (as funções ficam alguns minutos com versões misturadas).
- [ ] Recomendado: guardar esta versão no git antes de publicar.
  ```bash
  git init && git add -A && git commit -m "Correções de segurança e funcionamento (itens 1-29)"
  ```
  (Confira que o `.env` NÃO entrou: ele está no `.gitignore`.)
- [ ] Faça login na CLI do Supabase e ligue o projeto:
  ```bash
  npx supabase login
  ```
  ```bash
  npx supabase link --project-ref SEU_PROJECT_REF
  ```
  O `project-ref` é o código no endereço do painel: `supabase.com/dashboard/project/<project-ref>`.

## Etapa 1 — Backup do banco

- [ ] Painel do Supabase → **Database → Backups**: confira se existe um backup de hoje.
  No plano gratuito não há backup baixável; nesse caso faça um dump:
  ```bash
  npx supabase db dump --linked -f backup-antes-correcoes.sql
  ```
  ```bash
  npx supabase db dump --linked --data-only -f backup-dados-antes-correcoes.sql
  ```
  (O `db dump` precisa do Docker Desktop instalado e aberto.)

## Etapa 2 — Conferir o histórico de migrações

- [ ] Rode:
  ```bash
  npx supabase migration list
  ```
- **Caso A — as migrações antigas (até `20261022180000`) aparecem nas colunas Local E Remote:**
  ótimo, siga para a Etapa 3 e use o caminho A da Etapa 5.
- **Caso B — a coluna Remote está vazia ou faltando as antigas** (comum em projeto criado pelo Bolt):
  marque as antigas como já aplicadas, SEM executá-las:
  ```bash
  npx supabase migration repair --status applied 20260918195815 20260918201103 20260918210824 20260921181700 20260921182526 20260922215438 20260922221014 20260922221040 20260923174903 20260924193858 20260929201918 20261008180000 20261012180000 20261012200000 20261013120000 20261016140000 20261016190000 20261022180000
  ```
  Rode `npx supabase migration list` de novo: agora só as 9 novas (`20261105...` e `20261111...`) devem
  aparecer sem Remote.

  Se tiver dúvida se alguma das antigas realmente rodou no banco, **pare e me chame**
  antes de continuar.

## Etapa 3 — Diagnóstico antes da migração (SQL Editor)

Rode e guarde os resultados. Eles dizem quais segredos precisam ser trocados na Etapa 7.

- [ ] Alguém virou super admin?
  ```sql
  select id, email, name, created_at from public.users where is_super_admin;
  ```
  Deve listar **só você**. Qualquer outro: anote e me avise.
- [ ] Algum studio trocou a URL da Evolution (item 3)?
  ```sql
  select studio_id, instance_name, evolution_api_url
  from public.evolution_api_connections
  where coalesce(evolution_api_url, '') <> ''
    and evolution_api_url <> (select value from public.app_secrets where key = 'evolution_api_url');
  ```
  Nenhuma linha = o `webhook_secret` não vazou. Alguma linha = vazou (troque na Etapa 7).
- [ ] Os valores globais da Evolution estão preenchidos? (as funções novas só leem daqui)
  ```sql
  select key, length(value) as tamanho from public.app_secrets
  where key in ('evolution_api_url', 'evolution_api_key', 'webhook_secret', 'cron_secret', 'allowed_origin');
  ```
  `evolution_api_url` e `evolution_api_key` precisam ter tamanho > 0.

## Etapa 4 — Publicar as Edge Functions (ANTES das migrações)

As funções novas não dependem das migrações, mas as antigas quebram depois da migração.
Por isso: funções primeiro.

- [ ] ```bash
  npx supabase functions deploy
  ```
  Isso publica as 10 funções (as 8 antigas mais `billing` e `asaas-webhook`) e a pasta `_shared`. As configurações de JWT (`verify_jwt`)
  vêm do `supabase/config.toml`.
- [ ] Confira no painel → **Edge Functions** se as 10 aparecem com a data de hoje.

## Etapa 5 — Aplicar as migrações novas

- **Caminho A (CLI)**, depois de a Etapa 2 mostrar só as 9 novas pendentes:
  ```bash
  npx supabase db push
  ```
  A CLI lista o que vai aplicar e pede confirmação. **Leia a lista**: devem ser só
  arquivos `20261105...` e `20261111...`. Se aparecer qualquer outro, responda **n**.
- **Caminho B (manual)**: no SQL Editor, cole e rode **um arquivo por vez, nesta ordem**:
  1. `20261105120000_lock_users_and_evolution_secrets.sql`
  2. `20261105130000_private_client_photos.sql`
  3. `20261105130100_professional_scope.sql`
  4. `20261105130200_public_booking_rate_limit.sql`
  5. `20261105130400_schedule_reminders_cron.sql`
  6. `20261105140000_studio_timezone.sql`
  7. `20261105150000_birthday_lookup.sql`
  8. `20261105160000_studio_locale.sql`
  9. `20261111120000_sales_readiness.sql`

  (Se usar o caminho B, depois marque-as com `npx supabase migration repair --status applied <versão>`
  para a CLI não tentar aplicá-las de novo no futuro.)

- [ ] Verificação rápida (SQL Editor). Os dois resultados devem ser `false`:
  ```sql
  select has_table_privilege('authenticated', 'public.users', 'UPDATE') as pode_editar_users,
         has_column_privilege('authenticated', 'public.evolution_api_connections', 'evolution_api_key', 'SELECT') as pode_ler_chave;
  ```

## Etapa 6 — Configurações novas

- [ ] **SQL Editor** — endereço do app (CORS):
  ```sql
  update public.app_secrets set value = 'https://ENDERECO-DO-SEU-APP' where key = 'allowed_origin';
  ```
  **Não preencha `supabase_url`** no projeto de produção (`rprndjrdjuxdkliwasje`): lá já existe
  um agendador (`appointment-reminders`, a cada 15 min) chamando a função de lembretes.
  Preencher `supabase_url` liga um segundo agendador (`appointment-reminders-hourly`) e os
  dois passariam a disparar. Só preencha num projeto novo, que não tenha o agendador antigo.
  `allowed_origin` aceita vários, separados por vírgula
  (ex.: `https://app.meustudio.com.br,https://meustudio.netlify.app`).
  Enquanto estiver vazio, as funções continuam aceitando qualquer `*.netlify.app` / Bolt.
- [ ] Opcional — limite diário de respostas do GPT por studio (padrão 300):
  ```sql
  insert into public.app_secrets (key, value) values ('openai_daily_limit_per_studio', '300')
  on conflict (key) do update set value = excluded.value;
  ```
- [ ] Confira o cron dos lembretes:
  ```sql
  select jobname, schedule, active from cron.job;
  ```
  Deve aparecer `appointment-reminders-hourly` / `5 * * * *`. Se você já tinha criado
  outro agendamento para os lembretes no painel (**Integrations → Cron**), apague o antigo.
  Se a tabela `cron.job` não existir, ative **pg_cron** e **pg_net** em
  **Database → Extensions** e rode de novo o arquivo `20261105130400_schedule_reminders_cron.sql`.
- [ ] **Painel → Authentication → Policies/Settings → Password**: mínimo **8** caracteres.
- [ ] **Painel → Authentication → Multi-Factor**: confirme que **TOTP** está habilitado
  (o painel admin passa a exigir).

## Etapa 6B — Plano "pronta pra venda" (teste grátis, planos, cobrança)

A migração `20261111120000_sales_readiness.sql` cria os planos, o teste de 7 dias e a
cobrança. **Studios que já existem ficam como "ativos"** (não entram no prazo de teste);
só as contas novas começam em teste. Ajuste caso a caso no painel admin, se quiser.

- [ ] **Preços:** entre em `/admin` → "Planos e preços" e troque os valores de exemplo
  (Essencial R$ 97, Studio R$ 197, Pro R$ 397) e os limites de respostas da IA.
- [ ] **Asaas:** crie a conta, gere a chave de API e grave (comece em sandbox):
  ```sql
  update public.app_secrets set value = 'SUA_CHAVE_ASAAS' where key = 'asaas_api_key';
  update public.app_secrets set value = 'sandbox' where key = 'asaas_env'; -- depois: 'production'
  ```
- [ ] **Webhook da Asaas:** no painel Asaas → Integrações → Webhooks, crie um webhook com:
  - URL: `https://SEU_PROJECT_REF.supabase.co/functions/v1/asaas-webhook`
  - Token de autenticação: o valor de
    `select value from public.app_secrets where key = 'asaas_webhook_token';`
  - Eventos: cobranças (confirmada, recebida, vencida, estornada) e assinaturas (removida).
- [ ] **Teste em sandbox antes de vender:** crie uma conta nova no app, assine um plano em
  Configurações → Meu plano, pague a cobrança de teste na Asaas e confira se o status vira
  "Ativa". Este fluxo **não foi testado contra a Asaas real** durante o desenvolvimento.
- [ ] **Áudio:** a transcrição usa a mesma `openai_api_key` (modelo `whisper-1`; troque com a
  chave `openai_transcribe_model` em `app_secrets`, se quiser).
- [ ] **Botão de suporte:** na Netlify, defina a variável `VITE_SUPPORT_WHATSAPP` com o
  número de suporte (só dígitos, com 55) e publique de novo.
- [ ] **Termos e Privacidade:** preencha razão social, CNPJ e e-mail no topo de
  `src/pages/LegalPages.tsx` e **peça revisão de um advogado** antes de divulgar.
- [ ] **API oficial (plano Pro):** exige que o servidor da Evolution esteja configurado para
  a Cloud API da Meta (variáveis `WA_BUSINESS_*` e webhook da Meta apontando para a
  Evolution). A conexão pela tela Configurações **não foi testada com uma conta Meta real**.

## Etapa 7 — Trocar credenciais

- [ ] **Chave mestra da Evolution (obrigatório):** ela podia ser lida por qualquer usuário logado.
  1. No servidor da Evolution, troque `AUTHENTICATION_API_KEY` e reinicie.
  2. No SQL Editor:
     ```sql
     update public.app_secrets set value = 'NOVA_CHAVE' where key = 'evolution_api_key';
     ```
- [ ] **`webhook_secret` (só se a Etapa 3 mostrou alguma URL diferente):**
  1. Gere um novo:
     ```sql
     update public.app_secrets set value = encode(extensions.gen_random_bytes(32), 'hex')
     where key = 'webhook_secret' returning value;
     ```
  2. Registre o webhook de novo em cada instância (studios conectados não têm botão
     "Conectar" na tela). Liste as instâncias:
     ```sql
     select instance_name from public.evolution_api_connections where status = 'connected';
     ```
     E para cada uma (troque os 4 valores):
     ```bash
     curl -X POST "https://SUA-EVOLUTION/webhook/set/NOME_DA_INSTANCIA" -H "Content-Type: application/json" -H "apikey: NOVA_CHAVE" -d "{\"webhook\":{\"enabled\":true,\"url\":\"https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook\",\"headers\":{\"X-Webhook-Secret\":\"NOVO_WEBHOOK_SECRET\"},\"byEvents\":false,\"base64\":true,\"events\":[\"QRCODE_UPDATED\",\"CONNECTION_UPDATE\",\"MESSAGES_UPSERT\"]}}"
     ```
     Se preferir, me passe a lista de instâncias que eu monto um script.
- [ ] Se a Etapa 3 mostrou outro super admin: no SQL Editor,
  `update public.users set is_super_admin = false where id = '<id>';` e me avise
  para investigarmos o que foi acessado (`activity_logs`).

## Etapa 8 — Publicar o frontend (Netlify)

- [ ] Envie o código para o repositório ligado à Netlify (ou arraste a pasta `dist`
  gerada por `npm run build` em **Deploys**). O build é `npm run build`, publica `dist`.
- [ ] As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` continuam as mesmas.

## Etapa 9 — Testes de fumaça (15 min)

Com uma conta de **dona**:
- [ ] Login, Dashboard e Agenda abrem; criar e excluir um agendamento de teste (pede confirmação).
- [ ] **Studio**: aparecem "Fuso horário" e "Horário de funcionamento"; salvar funciona.
- [ ] **Clientes → ficha**: enviar uma foto e ver a foto aparecer.
- [ ] **Conversas**: o botão "IA ativa / IA pausada" alterna.
- [ ] **Configurações**: o status do WhatsApp aparece como conectado.

Pelo WhatsApp (de um celular que não é o do studio):
- [ ] Mandar "oi" → a IA responde.
- [ ] Pedir horário → só oferece horários dentro do funcionamento.
- [ ] Responder pelo celular do studio → a IA pausa naquela conversa.

Outros:
- [ ] Abrir o link público `/agendar/<slug>` e pedir um horário.
- [ ] `/admin`: login pede o código do app autenticador (no 1º acesso, mostra o QR).
- [ ] Conta nova: o cadastro pede o aceite dos termos e leva ao primeiro acesso em 4 passos;
  no fim, mandar "oi" de outro celular e ver a resposta aparecer na tela.
- [ ] Mandar um áudio curto → a IA responde ao que foi dito.
- [ ] Responder "SAIR" → a cliente recebe a confirmação e para de receber promoções.
- [ ] Em Studio, escolher "pedir minha aprovação", agendar pelo WhatsApp e confirmar na Agenda:
  a cliente deve receber o aviso de confirmação.
- [ ] Com uma conta de **profissional**: não aparece "Conversas"; só vê as clientes dela.
- [ ] Na hora cheia seguinte, painel → **Edge Functions → appointment-reminders → Logs**:
  deve haver uma execução sem erro.

## Se algo der errado

- **Funções:** a versão anterior está no zip original
  (`C:\Users\strat\Projects\project-bolt-sb1-ugohytmh-12\secretaria-ia-completo.zip`).
  Extraia em outra pasta e rode `npx supabase functions deploy` de lá.
  Atenção: as funções antigas não funcionam depois da migração `20261105120000`
  (que apaga as cópias da chave nas linhas) — para voltar a elas seria preciso restaurar o backup.
- **Banco:** restaure o backup da Etapa 1.
- **Frontend:** na Netlify, **Deploys** → escolha o deploy anterior → **Publish deploy**.
- Versão antiga desta pasta (de 23/09): `C:\Users\strat\Projects\secretaria-ia-backup-2026-09-23`.
