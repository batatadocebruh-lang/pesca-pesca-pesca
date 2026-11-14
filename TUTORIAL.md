# Tutorial Completo — Bot de Pesca Roblox (Sessão RDP Isolada)

> **Nota:** Este projeto está em desenvolvimento ativo. Siga os passos na ordem abaixo para evitar erros de permissão, rede ou resolução.

Este guia explica como instalar, abrir e operar o bot em uma sessão local isolada do Windows (`BotUser`), permitindo **minimizar a janela do jogo e usar o seu computador normalmente** enquanto o bot pesca em segundo plano.

---

## Passo 1 — Pré-requisitos

Antes de começar, certifique-se de ter no seu computador:

1. **Windows 10 ou Windows 11 (64-bit)** com acesso de **Administrador**.
2. **Node.js LTS** (versão 20 ou 22 recomendada): baixe em [nodejs.org](https://nodejs.org/) e instale usando o caminho padrão (`C:\Program Files\nodejs`).
3. **Git** (para clonar o repositório): baixe em [git-scm.com](https://git-scm.com/) — opcional caso você baixe o projeto compactado em `.zip`.
4. **Roblox** instalado no Windows (cliente oficial ou via Bloxstrap).

> **Dica:** Extraia ou clone o projeto em uma pasta fixa (não apague nem mova a pasta depois da instalação, pois o sistema cria uma junção apontando para ela).

---

## Passo 2 — Instalação automática (`Instalar_Tudo.bat`)

1. Abra a pasta do projeto.
2. Clique com o **botão direito** em `Instalar_Tudo.bat` e escolha **Executar como administrador**.
3. Confirme a janela do Controle de Conta de Usuário (UAC) clicando em **Sim**.

O instalador executa automaticamente as seguintes etapas:

1. **Dependências e compilação**: roda `npm install` para baixar `keysender`, `pngjs` e TypeScript, e compila o código (`tsc` -> pasta `dist/`).
2. **Usuário isolado `BotUser`**: cria (ou atualiza) o usuário local `BotUser` com senha **`123`** (sem expiração de senha) e o adiciona ao grupo de Administradores para permitir automação de janela e limpeza de RAM.
3. **Junção `C:\pesca` e atalho**: cria a junção NTFS `C:\pesca` apontando para a pasta do projeto, libera as permissões NTFS para o `BotUser` e cria o atalho `Iniciar_Bot_Pesca.bat` na Área de Trabalho Pública (`C:\Users\Public\Desktop\Iniciar_Bot_Pesca.bat`).
4. **RDP Wrapper (múltiplas sessões locais)**: baixa e instala o RDP Wrapper em `C:\Program Files\RDP Wrapper`, atualiza o `rdpwrap.ini`, libera a porta `3389` (TCP/UDP) no Firewall do Windows e reinicia o serviço `TermService`.
5. **GPU física e renderização em segundo plano**: habilita o uso da GPU física na sessão remota (`bEnumerateHWBeforeSW = 1`, profundidade de cor 32-bit) e grava `RemoteDesktop_SuppressWhenMinimized = 2` no Registro para que a captura de tela continue funcionando mesmo quando a janela RDP estiver minimizada.
6. **Otimizador de RAM e tarefa agendada**: executa [`otimizar_sistema_e_rdp.ps1`](otimizar_sistema_e_rdp.ps1), desativando decodificadores/caches pesados do `mstsc.exe`, aplicando FFlags de baixo consumo (`ClientAppSettings.json`) e qualidade nível `1` / `30 FPS` no Roblox, além de registrar a tarefa agendada **`OtimizadorRAM_PescaBot`** (roda [`trim_ram.ps1`](trim_ram.ps1) a cada 1 minuto como `SYSTEM`).
7. **Teste de detecção (`npm test`)**: valida automaticamente a leitura da interface usando [`nova_interface.png`](nova_interface.png) e os templates do bot.

---

## Passo 3 — Abrir a sessão remota e o Roblox

Na sua sessão normal do Windows:

1. Dê um duplo clique em **[`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat)** (que abre `mstsc.exe /v:127.0.0.2 /w:960 /h:600`) ou abra **[`Sessao_BotUser.rdp`](Sessao_BotUser.rdp)**.
2. Se aparecer um aviso de certificado ou segurança na primeira conexão, confirme para continuar.
3. Se pedir usuário e senha no primeiro logon:
   - **Usuário:** `BotUser` (ou `.\BotUser`)
   - **Senha:** `123`
4. Uma janela de área de trabalho isolada no tamanho **`960x600`** será aberta.
5. **Dentro dessa janela remota**, abra o Roblox (faça login com a conta que vai pescar, caso ainda não esteja logada no `BotUser`) e entre no jogo.

> **Importante:** Dentro da sessão remota (`960x600`), deixe a janela do Roblox **maximizada** ocupando a tela toda da sessão e posicione o personagem no ponto de pesca com a vara pronta. Se você pretende usar a troca automática de hotbar (`[F8]`), deixe um item neutro/slot vazio na tecla **`1`** e a vara de pesca na tecla **`3`**.

---

## Passo 4 — Iniciar e operar o bot

Ainda **dentro da janela da sessão remota (`BotUser`)**:

1. Na Área de Trabalho do `BotUser`, dê um duplo clique em **`Iniciar_Bot_Pesca.bat`** (ou abra `C:\pesca` e execute [`Iniciar_Bot.bat`](Iniciar_Bot.bat)).
2. O terminal vai executar o [`trim_ram.ps1`](trim_ram.ps1), compilar [`bot.ts`](bot.ts), calibrar a ROI para `960x600` (`x=158, y=420, 643x147`) e rodar um auto-teste rápido confirmando que o template foi carregado.
3. Deixe a janela do Roblox visível na sessão remota e use as teclas de atalho globais:

| Tecla | O que faz |
| --- | --- |
| **`[F6]`** | **Inicia ou pausa** o ciclo de pesca (lança a linha, aguarda o peixe na ROI, executa o autoclicker e finaliza o ciclo). |
| **`[F8]`** | **Ativa ou desativa** a troca automática na hotbar (tecla **`1`** -> tecla **`3`**) após cada captura e após timeouts. A escolha fica salva em [`config.json`](config.json). |
| **`[F7]`** | **Encerra o bot** de forma limpa, garantindo que o botão esquerdo do mouse seja solto antes de fechar o processo. |

> **Dica:** Para que `[F6]`, `[F7]` ou `[F8]` sejam capturados pelo bot, clique uma vez dentro da janela da sessão remota (para o teclado estar focado nela) e pressione a tecla desejada.

---

## Passo 5 — Como minimizar corretamente sem travar o bot

> **REGRA DE OURO:** Para voltar a usar seu PC normalmente, clique **SEMPRE no botão Minimizar (`_`)** na barra azul superior da janela remota. **NUNCA feche a janela no `X`.**

### Por que isso importa?

- **Se você fechar no `X`**: o cliente RDP desconecta a sessão visual do `BotUser`. Sem uma sessão de exibição conectada, o Windows congela/suspende a composição da tela remota e a captura DWM/BitBlt para de receber novos quadros do Roblox — o bot continua rodando, mas só enxerga tela preta ou parada.
- **Se você clicar em Minimizar (`_`)**: a configuração **`RemoteDesktop_SuppressWhenMinimized = 2`** (aplicada pelo instalador no Registro do Windows) instrui o cliente RDP a não suprimir a renderização quando minimizado. Assim, o DWM e o `BitBlt` continuam entregando frames normalmente para o [`bot.ts`](bot.ts) dentro da sessão do `BotUser`, enquanto você minimiza a janela na barra de tarefas e usa seu computador principal livremente.

---

## Passo 6 — Ajustes finos e Solução de Problemas

### 1. Ajustes finos de tempos e sensibilidade

Você pode ajustar os parâmetros sem editar arquivos manualmente: com o terminal do bot aberto (antes de apertar `[F6]` ou com o bot pausado), digite `config` para abrir o assistente passo a passo, ou altere um item direto com `config <chave> <valor>`. Também é possível rodar `npm run config` em um terminal dentro da pasta do projeto.

| Comando no terminal | Chave em `config.json` | Padrão atual | Quando ajustar |
| --- | --- | --- | --- |
| `config cast <ms>` | `timings.castHoldMs` | `1100` ms | Tempo segurando o clique ao lançar a linha. Diminua se a barra passar do *Perfect*; aumente se o lançamento ficar curto. |
| `config press <ms>` | `timings.clickPressMs` | `25` ms | Tempo com o botão esquerdo pressionado por clique durante a captura. |
| `config release <ms>` | `timings.clickReleaseMs` | `25` ms | Tempo com o botão solto entre cliques (`25 + 25 = 50 ms`, equivalente a ~20 CPS; também aceita `config cps <valor>`). |
| `config capture <ms>` | `timings.captureDurationMs` | `2700` ms | Duração total da sequência de cliques após detectar o peixe. Aumente se estiver faltando poucos cliques para finalizar a barra. |
| `config cooldown <ms>` | `timings.cooldownMs` | `4000` ms | Tempo de espera/coleta ao final do ciclo quando a troca de hotbar (`F8`) está desativada. |
| `config threshold <valor>` | `vision.threshold` | `0.78` | Sensibilidade visual (`0.50` a `0.99`, ou `50` a `99`). Abaixe um pouco (ex.: `0.73`) se não detectar a barra; aumente (ex.: `0.82`) se clicar antes da hora. |
| `hotbar` (ou `config hotbar on/off`) | `hotbar.enabled` | `false` | Liga ou desliga a troca `1` -> `3` para reequipar a vara entre ciclos (mesmo efeito do `[F8]`). |
| `config timeout <ms>` | `timings.biteTimeoutMs` | `12000` ms | Tempo máximo esperando o peixe morder antes de reiniciar o lançamento. |
| `config polling <ms>` | `timings.pollingIntervalMs` | `35` ms | Intervalo entre leituras da tela na fase de espera. |

Todas as alterações ficam gravadas automaticamente em [`config.json`](config.json). Se usar a hotbar ativada (`F8`), os tempos finos da animação de coleta e troca (`postCaptureDelayMs: 1500`, `keyPressMs: 100`, `slotSwitchDelayMs: 500`, `postEquipDelayMs: 1200`) também podem ser editados diretamente no [`config.json`](config.json).

---

### 2. Solução de Problemas (Troubleshooting)

#### Erro RDP `0x3` / `0x9` ou falha de logon/segurança (NLA)
- **Sintoma:** Ao abrir a sessão remota, aparece erro `0x3`, `0x9`, falha de CredSSP/NLA ou usuário/senha recusados.
- **Como resolver:**
  1. Execute [`setup_rdp_botuser.ps1`](setup_rdp_botuser.ps1) novamente como **Administrador** para reaplicar `UserAuthentication = 0`, `SecurityLayer = 0`, regras de firewall na porta `3389`, atualizar o `rdpwrap.ini` e reiniciar o serviço `TermService`.
  2. Dê preferência ao **[`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat)** (ele conecta direto em `127.0.0.2` sem depender de nome de máquina salvo).
  3. Se solicitar credenciais, digite o usuário como **`.\BotUser`** e a senha **`123`**.
  4. Caso o Windows tenha atualizado recentemente e alterado a versão do `termsrv.dll`, verifique no `RDPConf.exe` (extraído junto ao RDP Wrapper em `%TEMP%\RDPWrap-v1.6.2`) se o status do listener aparece como ativo/suportado.

#### Tela congelada ao minimizar a janela RDP
- **Sintoma:** O bot funciona com a janela remota aberta na tela, mas para de detectar peixes (`Captura válida: Não` ou similaridade travada) assim que você minimiza.
- **Como resolver:**
  1. Confira se você clicou em **Minimizar (`_`)** e **não** fechou a janela no **`X`**.
  2. Rode [`otimizar_sistema_e_rdp.ps1`](otimizar_sistema_e_rdp.ps1) (ou [`setup_rdp_botuser.ps1`](setup_rdp_botuser.ps1)) como **Administrador** na sua sessão principal para garantir que `RemoteDesktop_SuppressWhenMinimized = 2` esteja gravado em `HKCU`, `HKLM` e `WOW6432Node`.
  3. Feche a janela atual do `mstsc.exe` e reconecte pelo [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat) para que o cliente carregue a chave atualizada do Registro (o Roblox e o terminal na sessão do `BotUser` continuam abertos).

#### Resolução, escala da barra ou bot não detectando o minigame
- **Sintoma:** A captura está funcionando (`Captura válida: Sim`), mas a similaridade fica abaixo do limiar (`0.78`) e o bot vai para timeout sem clicar.
- **Como entender e resolver:**
  1. Ao iniciar, a função `autoCalibrateRoiForScreen()` do [`bot.ts`](bot.ts) detecta a resolução da tela da sessão e calcula a ROI proporcionalmente (`x = 16.5%`, `y = 70%`, `width = 67%`, `height = 24.5%`), salvando em [`config.json`](config.json).
  2. O Template Matching multi-escala inclui fatores de `0.667` até `1.345` (cobrindo de **`960x600`** até `1920x1080`) e prioriza a escala correspondente à altura da tela atual (`altura / 900`).
  3. **Use a resolução padrão `960x600`** via [`Conectar_RDP_BotUser.bat`](Conectar_RDP_BotUser.bat) (ROI calibrada: `x=158, y=420, 643x147`).
  4. Verifique se a janela do Roblox dentro da sessão remota está **maximizada** (sem cortes na parte inferior) e se a escala de exibição (DPI) do Windows na conta `BotUser` está em **100%**.
  5. Se você redimensionou a janela RDP depois que o bot já estava aberto, pressione `[F7]` para fechar o bot e inicie-o novamente para recalibrar a ROI.
  6. Digite `test` no terminal do bot (ou rode `npm test`) para confirmar que a detecção de [`peixe_alvo.png`](peixe_alvo.png), [`moldura_barra.png`](moldura_barra.png) e [`botao_parar.png`](botao_parar.png) em [`nova_interface.png`](nova_interface.png) está identificando a interface corretamente.
