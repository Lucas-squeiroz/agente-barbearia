# 🤖 Agente de IA para Barbearia — WhatsApp Bot

Agente de inteligência artificial para automatizar o atendimento e agendamento de uma barbearia via WhatsApp. Desenvolvido com Google Apps Script, Evolution API, Google Gemini e Google Agenda.

---

## 💡 Sobre o Projeto

Este projeto nasceu da necessidade de automatizar o atendimento de uma barbearia, eliminando a necessidade de responder manualmente cada cliente para agendar horários. O agente consegue entender mensagens de texto e áudio, identificar a intenção do cliente e realizar o agendamento de forma autônoma.

---

## ✨ Funcionalidades

- 📅 **Agendamento automático** — lista dias e horários disponíveis em tempo real direto da Google Agenda
- ❌ **Cancelamento de agendamentos** — localiza e cancela eventos pelo nome do cliente
- 🎤 **Transcrição de áudios** — entende mensagens de voz e responde normalmente
- 🧠 **Agendamento por áudio inteligente** — se o cliente disser "quero agendar um corte dia 12/05 às 10h", o bot agenda direto sem passar pelo menu
- 👤 **Histórico de clientes** — reconhece clientes recorrentes e personaliza o atendimento
- ⏱️ **Timeout de inatividade** — encerra conversas paradas automaticamente após 5 minutos
- 🔄 **Voltar ao menu** — cliente pode digitar "menu" a qualquer momento
- 🚫 **Limite de agendamentos** — controla o número máximo de agendamentos por mês por cliente
- 🗓️ **Feriados e horários especiais** — suporte a dias fechados e horários reduzidos via Google Agenda
- 🚷 **Bloqueio de grupos** — ignora mensagens de grupos do WhatsApp

---

## 🛠️ Tecnologias

| Tecnologia | Uso |
|---|---|
| Google Apps Script | Backend e lógica do agente |
| Evolution API | Integração com WhatsApp |
| Google Gemini 2.5 Flash | Processamento de linguagem natural e transcrição de áudios |
| Google Calendar API | Gestão de horários e agendamentos |
| Google Apps Script Properties | Armazenamento de estado das conversas e histórico |

---

## 🏗️ Arquitetura

```
Cliente (WhatsApp)
       ↓
Evolution API (Webhook)
       ↓
Google Apps Script (doPost)
       ↓
┌──────────────────────────────┐
│  Processamento da mensagem   │
│  - Texto ou Áudio?           │
│  - Transcrição (Gemini)      │
│  - Intenção completa?        │
└──────────────────────────────┘
       ↓
┌──────────────────────────────┐
│  Fluxo de conversa           │
│  - Saudação/Menu             │
│  - Escolha de serviço        │
│  - Escolha de dia            │
│  - Escolha de horário        │
│  - Confirmação de nome       │
└──────────────────────────────┘
       ↓
Google Calendar API
(Cria/Cancela eventos)
       ↓
Evolution API
(Envia resposta ao cliente)
```

---

## 🚀 Como configurar

### Pré-requisitos
- Conta Google com Google Agenda configurada
- Evolution API rodando (ex: Railway)
- Chave de API do Google Gemini (Google AI Studio)

### Passo a passo

**1. Clone o repositório**
```bash
git clone https://github.com/seu-usuario/agente-barbearia-whatsapp
```

**2. Crie um projeto no Google Apps Script**
- Acesse [script.google.com](https://script.google.com)
- Crie um novo projeto
- Cole o conteúdo do arquivo `agente_barbearia.gs`

**3. Configure as variáveis no bloco `CONFIG`**
```javascript
const CONFIG = {
  EVOLUTION_API_URL:  "https://sua-evolution-api.railway.app",
  EVOLUTION_API_KEY:  "sua-api-key",
  EVOLUTION_INSTANCE: "nome-da-instancia",
  GEMINI_API_KEY:     "sua-gemini-api-key",
  BARBERSHOP_NAME:    "Nome da Barbearia",
  BARBERS: [
    { name: "Nome do Barbeiro", calendarId: "email@gmail.com" },
  ],
  // ... demais configurações
};
```

**4. Publique como Web App**
- Implantar → Nova implantação → App da Web
- Executar como: Eu mesmo
- Quem pode acessar: Qualquer pessoa
- Copie a URL gerada

**5. Configure o Webhook na Evolution API**
- Acesse o painel da sua instância
- Cole a URL do Web App no campo Webhook
- Ative o evento `MESSAGES_UPSERT`
- Ative `Webhook Base64` para suporte a áudios

**6. Configure o acionador de inatividade**
- Apps Script → Extensões → Acionadores
- Adicionar acionador: `checkInactiveConversations` → Por tempo → A cada 5 minutos

---

## 📋 Serviços suportados

Configure os serviços e preços diretamente no bloco `CONFIG.SERVICES`:

```javascript
SERVICES: [
  { id: 1, name: "Corte",                        price: 45,  duration: 60  },
  { id: 2, name: "Corte + Barba",                price: 55,  duration: 90  },
  { id: 3, name: "Corte + Sobrancelha",          price: 50,  duration: 75  },
  // ...
],
```

---

## 🗓️ Feriados e dias especiais

Crie eventos na Google Agenda com os títulos abaixo para controlar dias especiais:

| Título do evento | Efeito |
|---|---|
| `FECHADO` | Bloqueia o dia todo |
| `FERIADO` | Bloqueia o dia todo |
| `HORÁRIO ESPECIAL 10-15` | Abre das 10h às 15h |

---

## 📱 Fluxo de conversa

```
Cliente: "Oi"
   Bot: Apresentação + Menu (Agendar / Cancelar / Dúvida)

Cliente: "1" (Agendar)
   Bot: Lista de serviços com preços

Cliente: "1" (Corte)
   Bot: Dias disponíveis

Cliente: "1" (Segunda)
   Bot: Horários disponíveis

Cliente: "2" (10:00)
   Bot: Solicita nome completo

Cliente: "João Silva"
   Bot: ✅ Agendamento confirmado!
```

### Agendamento inteligente por áudio
```
Cliente: 🎤 "Quero agendar um corte dia 12/05 às 10 horas"
   Bot: 🎤 "Ouvi seu áudio: Quero agendar um corte dia 12/05 às 10 horas"
   Bot: Encontrei o horário! ✅ Confirmo no nome de João Silva?
```

---

## 👨‍💻 Autor

Desenvolvido por **Lucas S. Queiroz**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](www.linkedin.com/in/lucas-queiroz-74a50315a)
[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Lucas-squeiroz)

---

## 📄 Licença

Este projeto está sob a licença MIT.
