# Bot Unificado de Pesca & Macros Roblox (Sessão RDP Isolada)

> **Status:** Projeto em desenvolvimento ativo. Os scripts e parâmetros funcionam no ambiente Windows 10/11 (64-bit), mas podem receber ajustes e melhorias contínuas.

Automação unificada para Roblox escrita em TypeScript reunindo em um só processo:
1. **Automação de Pesca** com [`keysender`](https://www.npmjs.com/package/keysender) e Template Matching multi-escala em buffer BGRA.
2. **Macros e Autoclicker (5 Perfis)** com [`uiohook-napi`](https://www.npmjs.com/package/uiohook-napi), gravação de sequências de teclas, controle de mouse/CPS e alternância entre perfis.
3. **Gerenciador Centralizado de Atalhos sem Conflitos**, garantindo exclusão mútua entre Pesca e Macros e evitando colisões com teclas internas, teclas gravadas em macros e atalhos do sistema.

---

## Por que usar esta automação

### Não restringe o uso do PC
- Roda isolada em uma sessão RDP local (`BotUser` em `127.0.0.2`, resolução `960x600`).
- Você pode **minimizar** a janela da sessão remota e continuar usando seu computador normalmente (trabalhar, navegar ou jogar outro jogo) sem que o bot roube o mouse/teclado ou dependa de manter a janela do Roblox em foco na tela principal.

### Gerenciamento de atalhos sem conflitos
- Todos os atalhos são controlados por uma única instância de [`HotkeyManager`](hotkeys.ts) via `uiohook-napi`.
- Pesca e Macro operam em **exclusão mútua** (iniciar um pausa o outro com segurança e libera teclas/mouse).
- Teclas injetadas pelo próprio bot (`keysender`) são suprimidas do hook para não autodispararem atalhos.
- A validação automática impede atalhos duplicados, bloqueia modificadores isolados/combos do sistema (`Alt+F4`, `Alt+Tab`, `Ctrl+Alt+Delete`, `Escape` puro) e impede conflito entre atalhos simples e teclas gravadas em [`profiles.json`](profiles.json).

### Consumo ultrabaixo de RAM e CPU
- **Roblox Game Client (`RobloxPlayerBeta`)**: **~270 MB de RAM** — otimizado com FFlags via `ClientAppSettings.json`, gráficos no nível `1`, limite de `30 FPS`, som zerado e prioridade de CPU em `BelowNormal`.
- **Conexão de Área de Trabalho Remota (`mstsc.exe`)**: **~4 a 41 MB de RAM** — decodificação AVC/H.264/DXVA e caches pesados desativados no Registro, combinados com expurgo periódico de Working Set.
- **Bot (`node --expose-gc`)**: Template Matching BGRA multi-escala com descarte rápido por contraste, coleta de lixo (`global.gc()`) periódica e acionamento do [`trim_ram.ps1`](trim_ram.ps1).

---

## Arquivos do projeto

| Arquivo | Função |
| --- | --- |
| [`bot.ts`](bot.ts) | Ponto de entrada unificado: captura da ROI via DWM (`screenBot`), detecção multi-escala BGRA, loop de pesca, coordenação de modos, CLI e comandos de terminal. |
| [`hotkeys.ts`](hotkeys.ts) | Gerenciador centralizado de atalhos globais sem conflitos (`HotkeyManager`), parser de combinações, detecção de colisões e supressão de teclas injetadas. |
| [`macros.ts`](macros.ts) | Motor de macros e autoclicker (`MacroEngine`) com 5 perfis em [`profiles.json`](profiles.json), execução cancelável e liberação segura de teclas seguradas. |
| [`config.json`](config.json) | Configurações persistidas de ROI, tempos da pesca, troca de hotbar, limiar visual, atalhos globais e índice do perfil de macro ativo. |
| [`profiles.json`](profiles.json) | Os 5 perfis de macro/autoclicker (sequências de teclas com duração em ms, `cicloDelay`, mouse ligado/desligado e `mouseDelay`). |
| [`Exportar_BotUser.bat`](Exportar_BotUser.bat) / [`Exportar_BotUser.ps1`](Exportar_BotUser.ps1) | Exporta e sincroniza o bot unificado para o `BotUser` (junção `C:\pesca`, `profiles.json`, dependências, build `tsc`, permissões NTFS e atalho `Iniciar_Bot_Pesca.bat`). |
| `Instalar_Tudo.bat` | Instalador completo (executar como Administrador): instala dependências, compila o TypeScript, cria o usuário `BotUser`, configura o RDP Wrapper, aplica otimizações e roda `npm test`. |
| [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat) | Compila (se necessário) e abre o cliente nativo [`RdpBotClient.cs`](RdpBotClient.cs) (`mstscax.dll`), conectando na sessão `BotUser` em **Tela Cheia adaptativa** (preenchendo qualquer monitor), mantendo `960x600` internos, acionando a entrada relativa nativa via `Ctrl+Alt+\` / `Ctrl+Alt+M` / `Ctrl+Alt+]` e disparando o início minimizado do bot sem duplicar instâncias (aceita `--windowed`). |
| [`RdpBotClient.cs`](RdpBotClient.cs) | Cliente RDP nativo em C# sobre `mstscax.dll` (`SmartSizing = true`, `960x600` fixos na sessão remota, `AllowRelativeMouseMode = true` + toggle nativo compatível com teclado ABNT2 via `Ctrl+Alt+\`, `Ctrl+Alt+M` e `Ctrl+Alt+]`, barra flutuante auto-ocultável em Tela Cheia e alternância Tela Cheia/Janela sem alterar a ROI). |
| [`Iniciar_Bot.bat`](Iniciar_Bot.bat) | Guarda de instância única na sessão (`dist\bot.js` / `Iniciar_Bot*.bat`), executa `trim_ram.ps1`, garante dependências, compila o projeto com `npx tsc` e inicia o bot com `node --expose-gc --max-old-space-size=96 dist\bot.js` (copiado como `Iniciar_Bot_Pesca.bat` na Área de Trabalho Pública). |
| [`Iniciar_Bot_Minimizado.vbs`](Iniciar_Bot_Minimizado.vbs) | Launcher silencioso acionado pela tarefa agendada `IniciarBotPesca_BotUser` no logon/reconexão do `BotUser` (`SW_SHOWMINNOACTIVE = 7`, minimizado na barra de tarefas) com verificação WMI de instância única na sessão. |
| [`setup_rdp_botuser.ps1`](setup_rdp_botuser.ps1) | Cria o usuário local `BotUser` (senha `123`), cria a junção `C:\pesca`, ajusta permissões NTFS, habilita GPU física no RDP, define `RemoteDesktop_SuppressWhenMinimized = 2`, registra `IniciarBotPesca_BotUser` (`Logon` + `RemoteConnect`), abre a porta `3389` e instala o RDP Wrapper. |
| [`otimizar_sistema_e_rdp.ps1`](otimizar_sistema_e_rdp.ps1) | Corrige vazamento de memória do `mstsc.exe`, encerra processos supérfluos, grava FFlags e XML de baixo consumo no Roblox e agenda a tarefa `OtimizadorRAM_PescaBot`. |
| [`trim_ram.ps1`](trim_ram.ps1) | Suspende processos em segundo plano na sessão remota (`NtSuspendProcess`), mantém `RobloxPlayerBeta` em `BelowNormal` e limpa o Working Set. |
| [`Sessao_BotUser.rdp`](Sessao_BotUser.rdp) | Perfil `.rdp` legado para `mstsc.exe` (`960x600`, `127.0.0.2`, `BotUser`, `smart sizing:i:1`, flags de mouse relativo). Observação: o `mstsc.exe` puro trava janela maximizada em `960x600` e não ativa mouse relativo em jogos desktop — prefira [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat). |
| Assets `.png` | Templates de visão computacional e validação: [`peixe_alvo.png`](peixe_alvo.png), [`moldura_barra.png`](moldura_barra.png), [`botao_parar.png`](botao_parar.png), [`nova_interface.png`](nova_interface.png) e referências legadas. |

---

## Instalação e Exportação para o BotUser

1. Instale o **Node.js LTS** no Windows (10 ou 11, 64-bit).
2. Se o ambiente do `BotUser` ainda não foi configurado, clique com o botão direito em `Instalar_Tudo.bat` e selecione **Executar como administrador**.
3. Caso o `BotUser` já esteja configurado e você queira apenas sincronizar atualizações/atalho na Área de Trabalho Pública, execute **[`Exportar_BotUser.bat`](Exportar_BotUser.bat)** (com elevação de Administrador quando solicitado).
4. Abra [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat) (ou o atalho `Conectar_RDP_BotUser` na Área de Trabalho) para entrar na sessão do `BotUser` em Tela Cheia (`960x600` internos). A tarefa `IniciarBotPesca_BotUser` ([`Iniciar_Bot_Minimizado.vbs`](Iniciar_Bot_Minimizado.vbs)) inicia automaticamente o `Iniciar_Bot_Pesca.bat` **minimizado na barra de tarefas** (sem abrir janela na frente do Roblox e sem duplicar se já estiver aberto). Atalhos da janela RDP: `Ctrl+Alt+Enter` / `Ctrl+Alt+Break` (Tela Cheia/Janela), `Ctrl+Alt+\`, `Ctrl+Alt+M` ou `Ctrl+Alt+]` (alternar Mouse Relativo nativo / liberar cursor; no Shift Lock do Roblox, ative `Shift` e pressione um desses atalhos — observe que, se o jogo reenviar cursor visível continuamente, a própria `mstscax.dll` solta a captura relativa por limitação nativa do RDP de desktop).

Para o passo a passo detalhado, consulte **[TUTORIAL.md](TUTORIAL.md)**.

---

## Atalhos e Comandos

### Atalhos globais padrão (sem conflitos)

| Tecla | Ação (`config.json`) | Descrição |
| --- | --- | --- |
| `F6` | `toggleFishing` | Inicia ou pausa o ciclo de **Pesca**. |
| `F7` | `toggleMacro` | Inicia ou pausa o **Macro / Autoclicker** do perfil atual. |
| `F8` | `toggleHotbarSwitch` | Ativa ou desativa a troca automática na hotbar (`1` -> `3`) na Pesca. |
| `Shift+F7` | `nextMacroProfile` | Alterna para o próximo perfil de Macro (`1` -> `2` -> `3` -> `4` -> `5` -> `1`). |
| `Shift+F6` | `stopAll` | Para imediatamente qualquer automação ativa (solta mouse e teclas) sem fechar o bot. |
| `Ctrl+F8` | `exitProcess` | Libera todos os inputs e encerra o bot de forma limpa. |

### Comandos interativos no terminal

- **Gerenciamento de Atalhos**:
  - `atalhos` — Lista todas as ações, suas teclas atuais e eventuais avisos.
  - `atalho <acao> <tecla>` — Reatribui uma tecla com validação contra conflitos (ex.: `atalho macro Shift+F9`, `atalho pesca F5`). Ações aceitas: `pesca`, `macro`, `hotbar`, `perfil`, `parar`, `sair`.
  - `atalho <acao> capturar` — Entra em modo de captura ao vivo para gravar a próxima combinação pressionada (`ESC` cancela).
  - `atalhos reset` — Restaura os atalhos padrão (`F6`, `F7`, `F8`, `Shift+F7`, `Shift+F6`, `Ctrl+F8`).
- **Pesca**:
  - `pesca` (`on` / `off` / `toggle` / `config`) e `pesca <chave> <valor>` (ou `config <chave> <valor>`): `cast`, `press`, `release`, `cps`, `capture`, `cooldown`, `timeout`, `polling`, `threshold`, `hotbar`.
  - `hotbar` (`on` / `off` / `toggle`) e `test` (também via `npm test`).
- **Macros e Perfis**:
  - `macro` (`on` / `off`), `perfis`, `perfil <1-5>`, `ver`, `nome <texto>`.
  - `gravar` (padrão) e `gravar real` (mede o tempo que você segurar cada tecla).
  - `tecla <n> <ms>`, `teclas <ms>`, `ciclo <ms>`, `mouse [on|off|<ms>]`, `cps <n>`, `limpar`.
- **Gerais**:
  - `config` (menu rápido), `status`, `parar`, `ajuda` / `help`, `sair` / `exit`.
