# Tutorial Completo — Bot Unificado de Pesca & Macros (Sessão RDP Isolada)

> **Nota:** Este projeto está em desenvolvimento ativo. Siga os passos na ordem abaixo para evitar erros de permissão, rede ou resolução.

Este guia explica como instalar, exportar para o `BotUser`, abrir e operar o bot unificado (Pesca + Macros/Autoclicker) em uma sessão local isolada do Windows (`BotUser`), permitindo **minimizar a janela do jogo e usar o seu computador normalmente**.

---

## Passo 1 — Pré-requisitos

Antes de começar, certifique-se de ter no seu computador:

1. **Windows 10 ou Windows 11 (64-bit)** com acesso de **Administrador**.
2. **Node.js LTS** (versão 20, 22 ou 24 recomendada): baixe em [nodejs.org](https://nodejs.org/) e instale usando o caminho padrão (`C:\Program Files\nodejs`).
3. **Roblox** instalado no Windows (cliente oficial ou via Bloxstrap).

> **Dica:** Mantenha o projeto em uma pasta fixa (não apague nem mova a pasta depois da instalação, pois o sistema utiliza a junção `C:\pesca` apontando para ela).

---

## Passo 2 — Instalação completa ou Exportação para `BotUser`

- **Primeira vez neste PC:** clique com o botão direito em `Instalar_Tudo.bat` e escolha **Executar como administrador**. O instalador instala as dependências (`keysender`, `pngjs`, `uiohook-napi`, TypeScript), compila o código, cria o usuário `BotUser` (senha `123`), cria a junção `C:\pesca`, ajusta as permissões NTFS, instala o RDP Wrapper e cria o atalho `Iniciar_Bot_Pesca.bat` em `C:\Users\Public\Desktop`.
- **Atualizando/Exportando o bot unificado para um `BotUser` já existente:** execute **[`Exportar_BotUser.bat`](Exportar_BotUser.bat)** (como Administrador). Ele valida `C:\pesca`, garante [`profiles.json`](profiles.json), instala dependências pendentes, compila o projeto, aplica permissões NTFS para o `BotUser` e atualiza o atalho `Iniciar_Bot_Pesca.bat` na Área de Trabalho Pública.

---

## Passo 3 — Abrir a sessão remota e o Roblox

Na sua sessão normal do Windows:

1. Dê um duplo clique em **[`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat)** (que abre `mstsc.exe /v:127.0.0.2 /w:960 /h:600`) ou abra **[`Sessao_BotUser.rdp`](Sessao_BotUser.rdp)**.
2. Se pedir usuário e senha no primeiro logon:
   - **Usuário:** `BotUser` (ou `.\BotUser`)
   - **Senha:** `123`
3. Dentro dessa janela remota (`960x600`), abra o Roblox, entre no jogo e deixe a janela **maximizada**.

---

## Passo 4 — Operar Pesca, Macros e Gerenciar Atalhos (sem conflitos)

Dentro da janela da sessão remota (`BotUser`):

1. Na Área de Trabalho do `BotUser`, dê um duplo clique em **`Iniciar_Bot_Pesca.bat`** (ou abra `C:\pesca` e execute [`Iniciar_Bot.bat`](Iniciar_Bot.bat)).
2. Clique dentro da janela do Roblox (ou onde deseja executar o macro) e use os atalhos globais padrão:

| Atalho Padrão | O que faz |
| --- | --- |
| **`[F6]`** | **Inicia ou pausa a Pesca** (se um Macro estiver ativo, pausa o macro automaticamente antes de iniciar). |
| **`[F7]`** | **Inicia ou pausa o Macro / Autoclicker** do perfil atual (se a Pesca estiver ativa, pausa a pesca antes de iniciar). |
| **`[F8]`** | **Ativa ou desativa** a troca automática na hotbar da Pesca (tecla **`1`** -> tecla **`3`**), salvando em [`config.json`](config.json). |
| **`[Shift+F7]`** | **Alterna para o próximo perfil de Macro** (`1` -> `2` -> `3` -> `4` -> `5` -> `1`). |
| **`[Shift+F6]`** | **Para tudo imediatamente** (solta botão do mouse e qualquer tecla segurada pelo macro sem fechar o bot). |
| **`[Ctrl+F8]`** | **Encerra o bot** de forma limpa. |

> **Dica:** Para que os atalhos globais sejam capturados dentro da sessão remota, a janela da sessão RDP precisa estar focada quando você pressiona o atalho — depois de iniciar a Pesca ou o Macro, você pode minimizar a janela RDP normalmente.

### Como alterar atalhos sem gerar conflitos

No terminal do bot, use os comandos abaixo (todas as alterações são validadas e salvas em [`config.json`](config.json)):

- `atalhos` — Exibe todos os atalhos atuais e suas ações.
- `atalho <acao> <tecla>` — Troca um atalho (ex.: `atalho macro Shift+F9`, `atalho pesca F5`, `atalho sair Ctrl+F10`).
  - Ações válidas: `pesca`, `macro`, `hotbar`, `perfil`, `parar`, `sair`.
  - O gerenciador **bloqueia** automaticamente teclas duplicadas, combinações reservadas do sistema (`Alt+F4`, `Alt+Tab`, `Ctrl+Alt+Delete`, `Escape` puro) e teclas simples que já estejam gravadas em algum perfil de [`profiles.json`](profiles.json).
- `atalho <acao> capturar` — Aguarda você pressionar fisicamente a nova tecla/combinação no teclado (`ESC` cancela).
- `atalhos reset` — Restaura os 6 atalhos padrão (`F6`, `F7`, `F8`, `Shift+F7`, `Shift+F6`, `Ctrl+F8`).

### Como gerenciar e gravar os 5 perfis de Macro

- `perfis` — Lista os 5 perfis salvos em [`profiles.json`](profiles.json).
- `perfil <1-5>` — Seleciona o perfil ativo (ex.: `perfil 3`).
- `ver` — Exibe mouse, delay do ciclo e sequência de teclas do perfil atual.
- `nome <texto>` — Renomeia o perfil atual.
- `gravar` — Grava teclas em sequência (pressione `ESC` para terminar e definir os tempos em ms e o delay do ciclo).
- `gravar real` — Grava cada tecla medindo exatamente o tempo que você segurou.
- `tecla <n> <ms>` / `teclas <ms>` / `ciclo <ms>` — Ajusta tempos de uma tecla, de todas as teclas ou do intervalo entre ciclos.
- `mouse` / `mouse on` / `mouse off` / `mouse <ms>` / `cps <n>` — Configura o autoclick do mouse no perfil atual.
- `limpar` — Apaga as teclas do perfil atual.

---

## Passo 5 — Como minimizar corretamente sem travar o bot

> **REGRA DE OURO:** Para voltar a usar seu PC normalmente, clique **SEMPRE no botão Minimizar (`_`)** na barra azul superior da janela remota. **NUNCA feche a janela no `X`.**

- **Se você fechar no `X`**: o cliente RDP desconecta a sessão visual do `BotUser` e o Windows pausa a composição da tela remota.
- **Se você clicar em Minimizar (`_`)**: a chave **`RemoteDesktop_SuppressWhenMinimized = 2`** mantém a renderização DWM ativa em segundo plano enquanto você usa seu computador principal livremente.

---

## Passo 6 — Ajustes finos da Pesca e Solução de Problemas

### Ajustes finos da Pesca

Use `pesca config` (ou `npm run config`), ou comandos diretos (`pesca <chave> <valor>` / `config <chave> <valor>`):

| Comando no terminal | Chave em `config.json` | Padrão atual | Quando ajustar |
| --- | --- | --- | --- |
| `config cast <ms>` | `timings.castHoldMs` | `1100` ms | Tempo segurando o clique ao lançar a linha. |
| `config press <ms>` | `timings.clickPressMs` | `25` ms | Tempo com botão esquerdo pressionado por clique na captura. |
| `config release <ms>` | `timings.clickReleaseMs` | `25` ms | Tempo com botão solto entre cliques na captura (ou use `config cps <n>`). |
| `config capture <ms>` | `timings.captureDurationMs` | `2700` ms | Duração total da sequência de cliques após detectar o peixe. |
| `config cooldown <ms>` | `timings.cooldownMs` | `4000` ms | Tempo de espera/coleta quando a troca de hotbar está desativada. |
| `config threshold <valor>` | `vision.threshold` | `0.78` | Sensibilidade visual (`0.50` a `0.99`, ou `50` a `99`). |
| `hotbar` (`on`/`off`) | `hotbar.enabled` | `false` | Liga ou desliga a troca `1` -> `3` para reequipar a vara entre ciclos. |
| `config timeout <ms>` | `timings.biteTimeoutMs` | `12000` ms | Tempo máximo esperando o peixe morder antes de relançar. |
| `config polling <ms>` | `timings.pollingIntervalMs` | `35` ms | Intervalo entre leituras da tela na fase de espera. |

### Solução de Problemas (Troubleshooting)

- **Erro RDP `0x3` / `0x9` ou falha de logon:** execute [`setup_rdp_botuser.ps1`](setup_rdp_botuser.ps1) como Administrador e reconecte com [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat).
- **Tela congelada ao minimizar:** verifique se minimizou no `_` (e não no `X`), execute [`otimizar_sistema_e_rdp.ps1`](otimizar_sistema_e_rdp.ps1) como Administrador e reconecte o `mstsc.exe`.
- **Bot não detecta o minigame:** mantenha o RDP em `960x600`, Roblox maximizado e rode `test` no terminal (ou `npm test`) para validar os templates [`peixe_alvo.png`](peixe_alvo.png), [`moldura_barra.png`](moldura_barra.png) e [`botao_parar.png`](botao_parar.png).
- **BotUser sem acesso a arquivos novos ou atalho desatualizado:** execute [`Exportar_BotUser.bat`](Exportar_BotUser.bat) como Administrador para reaplicar as permissões NTFS e sincronizar `C:\Users\Public\Desktop\Iniciar_Bot_Pesca.bat`.
