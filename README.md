# Bot de Pesca Roblox (Sessão RDP Isolada)

> **Status:** Projeto em desenvolvimento ativo. Os scripts e parâmetros funcionam no ambiente Windows 10/11 (64-bit), mas podem receber ajustes e melhorias contínuas.

Automação de pesca para Roblox escrita em TypeScript com [`keysender`](https://www.npmjs.com/package/keysender) e Template Matching multi-escala em buffer BGRA. O bot monitora a região da barra de pesca na tela, detecta o minigame pelo ícone do peixe ou pela moldura/botão da interface e executa o ciclo de lançamento, captura e espera/troca de hotbar dentro de uma sessão remota local isolada.

---

## Por que usar esta automação

### Não restringe o uso do PC
- Roda isolada em uma sessão RDP local (`BotUser` em `127.0.0.2`, resolução `960x600`).
- Você pode **minimizar** a janela da sessão remota e continuar usando seu computador normalmente (trabalhar, navegar ou jogar outro jogo) sem que o bot roube o mouse/teclado ou dependa de manter a janela do Roblox em foco na tela principal.

### Consumo ultrabaixo de RAM e CPU
- **Roblox Game Client (`RobloxPlayerBeta`)**: **~270 MB de RAM** — otimizado com FFlags via `ClientAppSettings.json`, gráficos no nível `1`, limite de `30 FPS`, som zerado e prioridade de CPU em `BelowNormal`.
- **Conexão de Área de Trabalho Remota (`mstsc.exe`)**: **~4 a 41 MB de RAM** — decodificação AVC/H.264/DXVA e caches pesados desativados no Registro, combinados com expurgo periódico de Working Set.
- **Bot (`node --expose-gc`)**: **~38 MB de RAM** — Template Matching BGRA multi-escala com descarte rápido por contraste (~35–50 ms por leitura), coleta de lixo (`global.gc()`) a cada 10 leituras para liberar buffers `HBITMAP` do Windows e acionamento do `trim_ram.ps1` com `NtSuspendProcess` e `EmptyWorkingSet`.

---

## Arquivos do projeto

| Arquivo | Função |
| --- | --- |
| [`bot.ts`](bot.ts) | Código principal em TypeScript: captura da ROI via DWM (`screenBot`), detecção multi-escala BGRA, calibração automática de ROI, loop de pesca, hotkeys e comandos de terminal/CLI. |
| [`config.json`](config.json) | Configurações persistidas de ROI, tempos de lançamento/captura/coleta, troca de hotbar, autoclicker e limiar de detecção visual. |
| `Instalar_Tudo.bat` | Instalador automático (executar como Administrador): instala dependências, compila o TypeScript, cria o usuário `BotUser`, configura o RDP Wrapper, aplica otimizações e roda `npm test`. |
| [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat) | Abre a sessão RDP local (`mstsc.exe /v:127.0.0.2 /w:960 /h:600`) conectando na conta isolada do bot. |
| [`Iniciar_Bot.bat`](Iniciar_Bot.bat) | Executa o `trim_ram.ps1`, compila o projeto com `npx tsc` e inicia o bot com `node --expose-gc --max-old-space-size=96 dist\bot.js` (também copiado como `Iniciar_Bot_Pesca.bat` na Área de Trabalho Pública). |
| [`setup_rdp_botuser.ps1`](setup_rdp_botuser.ps1) | Cria o usuário local `BotUser` (senha `123`), cria a junção `C:\pesca`, ajusta permissões NTFS, habilita GPU física no RDP, define `RemoteDesktop_SuppressWhenMinimized = 2`, abre a porta `3389` e instala o RDP Wrapper. |
| [`otimizar_sistema_e_rdp.ps1`](otimizar_sistema_e_rdp.ps1) | Corrige vazamento de memória do `mstsc.exe`, encerra processos supérfluos, grava FFlags e XML de baixo consumo no Roblox e agenda a tarefa `OtimizadorRAM_PescaBot` (execução a cada 1 minuto). |
| [`trim_ram.ps1`](trim_ram.ps1) | Suspende processos em segundo plano na sessão remota (`NtSuspendProcess`), mantém `RobloxPlayerBeta` em `BelowNormal` e limpa o Working Set (`EmptyWorkingSet` e `SetProcessWorkingSetSizeEx`). |
| [`Sessao_BotUser.rdp`](Sessao_BotUser.rdp) | Perfil `.rdp` pré-configurado (`960x600`, `127.0.0.2`, `BotUser`, 32 bpp, `smart sizing` ativo e sem redirecionamentos pesados). |
| Assets `.png` | Templates de visão computacional e imagens de validação: [`peixe_alvo.png`](peixe_alvo.png) (peixe da interface atual), [`moldura_barra.png`](moldura_barra.png) (fallback pela moldura da barra/card para qualquer espécie), [`botao_parar.png`](botao_parar.png) (fallback pelo botão `PARAR`), [`nova_interface.png`](nova_interface.png) (usada no auto-teste `test`), além das referências legadas [`peixe_alvo_antigo.png`](peixe_alvo_antigo.png), [`Captura de tela 2026-10-29 233138.png`](Captura%20de%20tela%202026-10-29%20233138.png) e [`Captura de tela 2026-10-29 234747.png`](Captura%20de%20tela%202026-10-29%20234747.png). |

---

## Instalação rápida

1. Instale o **Node.js LTS** e o **Git** no Windows (10 ou 11, 64-bit).
2. Baixe ou clone este repositório.
3. Clique com o botão direito em `Instalar_Tudo.bat` e selecione **Executar como administrador**.
4. Ao terminar, abra [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat) para entrar na sessão do `BotUser` (`960x600`), abra o Roblox dentro dela e execute `Iniciar_Bot_Pesca.bat` na Área de Trabalho da sessão remota (ou [`Iniciar_Bot.bat`](Iniciar_Bot.bat) em `C:\pesca`).

Para o passo a passo detalhado com dicas de uso e solução de problemas, consulte o guia completo em **[TUTORIAL.md](TUTORIAL.md)**.

---

## Atalhos e comandos

### Atalhos globais (Hotkeys)

| Tecla | Ação |
| --- | --- |
| `F6` | Inicia ou pausa o ciclo de automação. |
| `F8` | Ativa ou desativa a troca automática na hotbar (`1` -> `3`) e salva em [`config.json`](config.json). |
| `F7` | Solta o botão esquerdo do mouse e encerra o bot de forma limpa. |

### Comandos interativos no terminal e via CLI

Com o bot aberto no terminal, você pode digitar comandos diretamente (ou executá-los via `npm` / `node dist/bot.js`):

- `config` — Abre o assistente passo a passo no terminal para ajustar tempos e sensibilidade (também disponível via `npm run config`).
- `config <chave> <valor>` — Altera um parâmetro específico e salva em [`config.json`](config.json). Exemplos:
  - `config cast 1100` (tempo segurando o clique no lançamento em ms)
  - `config press 25` (tempo pressionado por clique na captura em ms)
  - `config release 25` (tempo solto entre cliques na captura em ms)
  - `config cps 20` (define cliques por segundo ajustando `press`/`release`)
  - `config capture 2700` (duração total do autoclicker na captura em ms)
  - `config cooldown 4000` (espera pós-captura quando a hotbar está desativada, em ms)
  - `config timeout 12000` (tempo máximo esperando o peixe morder, em ms)
  - `config polling 35` (intervalo de leitura da ROI em ms)
  - `config threshold 0.78` (limiar de similaridade visual entre `0.50` e `0.99`)
  - `config hotbar on` / `off` (ativa ou desativa a troca de slots `1` -> `3`)
- `hotbar` — Alterna rapidamente a troca automática de slots (`hotbar`, `hotbar on`, `hotbar off` ou `hotbar toggle`).
- `test` — Executa o teste de detecção visual na captura [`nova_interface.png`](nova_interface.png) e exibe as similaridades de cada template (também disponível via `npm test`).
- `help` ou `ajuda` — Exibe os valores atuais carregados e os comandos aceitos.
