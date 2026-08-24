# Controle de Obras

App para controlar **materiais comprados, fornecedores, orçamento e pagamentos** de várias
casas/obras ao mesmo tempo. Feito para ser usado pelo celular, no navegador, por você e pelos
encarregados — cada um com seu próprio login.

Não depende de nenhum serviço externo (sem Firebase, sem Google Sheets, sem serviços pagos de
terceiros): os dados ficam guardados no seu próprio servidor, em um banco de dados local.

## O que o app faz

- Login com usuário e senha para cada pessoa da equipe (administrador ou encarregado).
- Cadastro de casas/obras, cada uma com orçamento previsto.
- Cadastro de fornecedores.
- Lançamento de compras de material (despesas): casa, fornecedor, categoria, quantidade, valor,
  forma de pagamento e status (pago/pendente).
- Lançamento de receitas: venda, entrada/sinal, parcela, financiamento, aluguel, etc. — pode ser
  vinculada a uma casa específica ou lançada como receita geral (sem casa).
- Painel com o gasto de cada casa comparado com o orçamento previsto (barra de progresso).
- Painel geral com receitas, despesas, saldo e valores a receber — de todas as casas juntas.
- Controle de quanto já foi pago/recebido e quanto ainda está pendente, por casa e no total.
- Relatório mensal (demonstrativo de despesas e receitas) com totais por casa, por categoria e
  lista de lançamentos — pronto para gerar em PDF direto do navegador.
- Cadastro da equipe (só o administrador cadastra novos usuários).

## Requisitos técnicos

- **Node.js versão 22.5 ou superior** (o app usa o banco de dados SQLite embutido no próprio
  Node, então **não precisa instalar nada com `npm install`** — nenhuma dependência externa).
- Ou, se preferir, **Docker** (não precisa nem instalar Node — o Dockerfile já cuida disso).

## Testar rapidamente (sem Docker)

```bash
node server.js
```

Acesse `http://localhost:3000` no navegador.

Na primeira vez que o app rodar, ele cria automaticamente um usuário administrador:

- **usuário:** `admin`
- **senha:** `mudar123` (ou o que você definir na variável `ADMIN_SENHA_INICIAL`, veja abaixo)

**Troque essa senha assim que entrar** (tela "Equipe" → clique no Administrador → digite a
nova senha → Salvar).

## Colocando em um servidor próprio (produção)

### Opção 1 — Docker (mais simples de manter)

1. Copie a pasta do projeto para o seu servidor (VPS).
2. Se quiser mudar a senha inicial do admin, edite o arquivo `docker-compose.yml` e mude o
   valor de `ADMIN_SENHA_INICIAL` antes do primeiro uso.
3. Rode:
   ```bash
   docker compose up -d
   ```
4. O app fica disponível na porta 3000 do servidor (`http://SEU_SERVIDOR:3000`).
5. Os dados ficam salvos na pasta `./data` ao lado do projeto — faça backup dela regularmente
   (é só um arquivo `obras.db`, pode copiar para outro lugar).

Para atualizar o app no futuro (depois de enviar arquivos novos), rode:
```bash
docker compose up -d --build
```
Os dados continuam intactos, porque ficam fora do container (pasta `./data`).

### Opção 2 — Node.js direto no servidor (sem Docker)

1. Instale o Node.js 22+ no servidor (VPS com Ubuntu, por exemplo):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
   sudo apt-get install -y nodejs
   ```
2. Copie a pasta do projeto para o servidor.
3. Rode o app mantendo ele sempre ativo com o `pm2` (gerenciador de processos):
   ```bash
   sudo npm install -g pm2
   ADMIN_SENHA_INICIAL=escolha_uma_senha pm2 start server.js --name obras-app
   pm2 save
   pm2 startup
   ```
4. O app fica disponível em `http://SEU_SERVIDOR:3000`.

### Acesso com endereço próprio e HTTPS (recomendado)

Por padrão o app fala HTTP puro na porta 3000. Para acessar por um endereço tipo
`https://obras.suaempresa.com.br` com cadeado de segurança, coloque um proxy reverso na
frente — o mais simples é o **Caddy** (ele já cuida do certificado HTTPS sozinho):

```
# Caddyfile
obras.suaempresa.com.br {
    reverse_proxy localhost:3000
}
```

Isso é importante porque o app trafega senha de login — sem HTTPS, essa senha viaja sem
criptografia pela internet.

### Variáveis de ambiente

| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | Porta em que o app roda | `3000` |
| `ADMIN_SENHA_INICIAL` | Senha do usuário `admin` criado automaticamente na primeira vez que o app roda (só tem efeito se ainda não existir nenhum usuário cadastrado) | `mudar123` |

## Relatório mensal em PDF

No Painel, o botão **"Relatório mensal em PDF"** abre o demonstrativo do mês (escolha o mês
desejado no seletor). Ele mostra o total de receitas, despesas e saldo, o resumo por casa/obra,
por categoria, e a lista completa de lançamentos do mês.

Para gerar o PDF, clique em **"Gerar PDF"** — isso abre a caixa de impressão do próprio
navegador (a mesma tecla de atalho é Ctrl+P / Cmd+P). Escolha **"Salvar como PDF"** como
destino/impressora. O app não depende de nenhum serviço externo para isso — é o navegador que
gera o arquivo.

## Backup

Todos os dados (casas, fornecedores, compras, receitas, usuários) ficam em um único arquivo:
`data/obras.db`. Faça uma cópia desse arquivo regularmente (ex: todo fim de dia) para um local
seguro — um e-mail para você mesmo, um Google Drive, um pendrive, o que for mais prático.

## Estrutura do projeto

```
obras-app/
├── server.js          # servidor (rotas da API, tudo em Node.js puro)
├── db.js               # banco de dados (SQLite) e criação do usuário admin inicial
├── auth.js              # login por sessão (sem bibliotecas externas)
├── public/              # telas do app (HTML, CSS, JavaScript)
├── data/                 # banco de dados fica aqui (criado automaticamente)
├── Dockerfile
└── docker-compose.yml
```

## Próximos passos possíveis (caso queira expandir depois)

- Anexar foto da nota fiscal em cada compra.
- Gráfico de gastos e receitas por categoria (material, mão de obra, etc.).
- Exportar o relatório mensal em Excel, além do PDF.

Qualquer um desses pode ser adicionado depois — é só pedir.
