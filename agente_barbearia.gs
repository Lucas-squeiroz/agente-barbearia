// ============================================================
//  AGENTE IA - BARBEARIA
//  Evolution API + Gemini + Google Agenda
//  Autor: Lucas-squeiroz
// ============================================================

// -----------------------------------------------------------
//  ⚙️  CONFIGURAÇÕES — preencha com seus dados antes de publicar
// -----------------------------------------------------------
const CONFIG = {
  // Evolution API
  EVOLUTION_API_URL:  "https://SUA_URL.railway.app",
  EVOLUTION_API_KEY:  "SUA_EVOLUTION_API_KEY",
  EVOLUTION_INSTANCE: "NOME_DA_INSTANCIA",

  // Gemini
  GEMINI_API_KEY: "SUA_GEMINI_API_KEY",

  // Barbearia
  BARBERSHOP_NAME: "Nome da Barbearia",
  TIMEZONE:        "America/Sao_Paulo",
  DAYS_AHEAD:      8, // quantos dias à frente exibir para agendamento

  // Barbeiros — adicione quantos precisar
  // calendarId: e-mail do Google associado à agenda de cada barbeiro
  BARBERS: [
    { name: "Nome do Barbeiro", calendarId: "email@gmail.com" },
  ],

  // Horários de funcionamento por dia da semana
  // 0=Domingo, 1=Segunda ... 6=Sábado
  // open: false = dia fechado
  SCHEDULE: {
    0: { open: true,  start: 10, end: 15 }, // Domingo: meio período
    1: { open: false, start: 10, end: 19 }, // Segunda: fechado
    2: { open: true,  start: 10, end: 19 },
    3: { open: true,  start: 10, end: 19 },
    4: { open: true,  start: 10, end: 19 },
    5: { open: true,  start: 10, end: 19 },
    6: { open: true,  start: 10, end: 19 },
  },

  // Intervalo entre slots (minutos) — define a grade de horários
  SLOT_DURATION: 30,

  // Serviços oferecidos — name, price (R$) e duration (minutos)
  SERVICES: [
    { id: 1, name: "Corte",                          price: 45,  duration: 45  },
    { id: 2, name: "Barba",                          price: 35,  duration: 40  },
    { id: 3, name: "Sobrancelha",                    price: 15,  duration: 20  },
    { id: 4, name: "Penteado",                       price: 30,  duration: 30  },
    { id: 5, name: "Corte & Barba",                  price: 75,  duration: 75  },
    { id: 6, name: "Corte infantil",                 price: 40,  duration: 40  },
    { id: 7, name: "Corte + sobrancelha & penteado", price: 60,  duration: 75  },
    { id: 8, name: "Limpeza bigode",                 price: 10,  duration: 15  },
  ],

  // Limites
  INACTIVITY_TIMEOUT:    5, // minutos até encerrar conversa inativa
  MAX_BOOKINGS_PER_MONTH: 6, // máximo de agendamentos por cliente por mês
};

// ============================================================
//  CACHE DE CONVERSAS
//  Usa ScriptProperties para persistir o estado entre mensagens
// ============================================================

function getConversation(phone) {
  const raw = PropertiesService.getScriptProperties().getProperty("conv_" + phone);
  return raw ? JSON.parse(raw) : { stage: "greeting", data: {}, lastActivity: Date.now() };
}

function saveConversation(phone, conv) {
  conv.lastActivity = Date.now();
  PropertiesService.getScriptProperties().setProperty("conv_" + phone, JSON.stringify(conv));
}

function clearConversation(phone) {
  PropertiesService.getScriptProperties().deleteProperty("conv_" + phone);
}

// ============================================================
//  HISTÓRICO DO CLIENTE
//  Reconhece clientes recorrentes e personaliza o atendimento
// ============================================================

function getClientHistory(phone) {
  const raw = PropertiesService.getScriptProperties().getProperty("hist_" + phone);
  return raw ? JSON.parse(raw) : { name: null, bookings: [] };
}

function saveClientHistory(phone, history) {
  PropertiesService.getScriptProperties().setProperty("hist_" + phone, JSON.stringify(history));
}

function recordBooking(phone, clientName, service, slot) {
  const history = getClientHistory(phone);
  history.name = clientName;
  history.bookings.push({
    date:    new Date(slot.start).toISOString(),
    service: service.name,
    price:   service.price,
  });
  if (history.bookings.length > 20) history.bookings = history.bookings.slice(-20);
  saveClientHistory(phone, history);
}

function getBookingsThisMonth(phone) {
  const history = getClientHistory(phone);
  const now = new Date();
  return history.bookings.filter(b => {
    const d = new Date(b.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
}

// ============================================================
//  TIMEOUT DE INATIVIDADE
//  Encerra conversas paradas após INACTIVITY_TIMEOUT minutos
//  Configure um acionador de tempo a cada 5 min para checkInactiveConversations
// ============================================================

function isConversationExpired(conv) {
  if (!conv.lastActivity) return false;
  return (Date.now() - conv.lastActivity) / 60000 > CONFIG.INACTIVITY_TIMEOUT;
}

function checkInactiveConversations() {
  const props = PropertiesService.getScriptProperties();
  props.getKeys().forEach(key => {
    if (!key.startsWith("conv_")) return;
    const phone = key.replace("conv_", "");
    const conv  = getConversation(phone);
    if (conv.stage !== "greeting" && isConversationExpired(conv)) {
      clearConversation(phone);
      sendWhatsApp(phone, "Sua conversa foi encerrada por inatividade. Quando quiser agendar é só chamar! 😊");
    }
  });
}

// ============================================================
//  WEBHOOK — recebe mensagens da Evolution API
// ============================================================

function doPost(e) {
  try {
    const contents = e?.postData?.contents;
    if (!contents) return okResponse();

    const body = JSON.parse(contents);
    if (!body.data || body.event !== "messages.upsert") return okResponse();

    const msg = body.data;
    if (msg.key?.fromMe) return okResponse();

    const phone = msg.key.remoteJid;
    if (phone.endsWith("@g.us")) return okResponse(); // ignora grupos

    const messageType = msg.messageType;
    let text = "";

    if (messageType === "conversation" || messageType === "extendedTextMessage") {
      text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || "";
    } else if (messageType === "audioMessage" || messageType === "pttMessage") {
      text = transcribeAudio(msg, phone);
      if (!text) return okResponse();
      sendWhatsApp(phone, `🎤 _Ouvi seu áudio:_\n"${text}"`);

      // Tenta agendar direto se o áudio tiver todas as informações
      const intencao = extrairIntencaoCompleta(text);
      if (intencao.temTudo) {
        const resultado = agendarDireto(phone, intencao);
        if (resultado) {
          sendWhatsApp(phone, resultado);
          return okResponse();
        }
      }
    } else {
      sendWhatsApp(phone, "Por enquanto só respondo textos e áudios. 😊 Me manda em texto!");
      return okResponse();
    }

    if (!text.trim()) return okResponse();

    const reply = processMessage(phone, text.trim());
    if (reply) sendWhatsApp(phone, reply);

  } catch (err) {
    Logger.log("doPost error: " + err.stack);
  }
  return okResponse();
}

function okResponse() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
                       .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  TRANSCRIÇÃO DE ÁUDIO
//  Baixa o áudio via Evolution API e transcreve com Gemini
// ============================================================

function transcribeAudio(msg, phone) {
  try {
    if (!msg.message?.audioMessage?.url) {
      sendWhatsApp(phone, "Não consegui ouvir seu áudio. Pode mandar em texto? 😊");
      return null;
    }

    const res = UrlFetchApp.fetch(
      `${CONFIG.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${CONFIG.EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        contentType: "application/json",
        headers: { "apikey": CONFIG.EVOLUTION_API_KEY },
        payload: JSON.stringify({ message: { key: msg.key, message: msg.message }, convertToMp4: false }),
        muteHttpExceptions: true,
      }
    );

    const base64Audio = JSON.parse(res.getContentText())?.base64;
    if (!base64Audio) {
      sendWhatsApp(phone, "Não consegui ouvir seu áudio. Pode mandar em texto? 😊");
      return null;
    }

    return callGeminiWithAudio(base64Audio, "audio/ogg; codecs=opus");

  } catch (err) {
    Logger.log("Erro transcrição: " + err.stack);
    sendWhatsApp(phone, "Não consegui ouvir seu áudio. Pode mandar em texto? 😊");
    return null;
  }
}

function callGeminiWithAudio(base64, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const res = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: "Transcreva exatamente o que está sendo dito neste áudio em português. Retorne apenas a transcrição, sem comentários." }
        ]
      }]
    }),
    muteHttpExceptions: true,
  });
  return JSON.parse(res.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ============================================================
//  AGENDAMENTO INTELIGENTE POR ÁUDIO
//  Extrai intenção completa e agenda sem passar pelo menu
// ============================================================

function extrairIntencaoCompleta(text) {
  const prompt = `Analise o texto e extraia informações de agendamento. Retorne SOMENTE um JSON:
{
  "temTudo": boolean (true se tiver serviço + data + horário),
  "servico": string ou null,
  "data": string ou null (ex: "11/05", "amanhã", "segunda"),
  "horario": string ou null (ex: "16:00", "16h")
}
Texto: "${text}"
Responda APENAS com o JSON.`;

  try {
    const response = callGemini([{ role: "user", parts: [{ text: prompt }] }]);
    return JSON.parse(response.replace(/```json|```/g, "").trim());
  } catch (e) {
    return { temTudo: false };
  }
}

function agendarDireto(phone, intencao) {
  const service = CONFIG.SERVICES.find(s =>
    s.name.toLowerCase().includes(intencao.servico?.toLowerCase() || "")
  );
  if (!service) return null;

  const targetDate = interpretarData(intencao.data);
  if (!targetDate) return null;

  const targetHour = interpretarHorario(intencao.horario);
  if (targetHour === null) return null;

  const slots = getAvailableSlotsForDay(targetDate.getTime(), service);
  const slot  = slots.find(s => new Date(s.start).getHours() === targetHour);

  if (!slot) {
    if (slots.length > 0) {
      const conv = getConversation(phone);
      conv.stage = "choosing_time";
      conv.data  = { service, chosenDay: targetDate.getTime(), availableSlots: slots, availableDays: [targetDate.getTime()] };
      saveConversation(phone, conv);
      return `Não tenho esse horário disponível em ${formatDay(targetDate.getTime())}.\n\nHorários disponíveis:\n\n${slots.map((s, i) => `${i + 1}. ${formatTime(s.start)}`).join("\n")}\n\nQual prefere?`;
    }
    return `Não tenho horários em ${formatDay(targetDate.getTime())} para ${service.name}. Digite *menu* para ver outros dias.`;
  }

  const conv    = getConversation(phone);
  const history = getClientHistory(phone);
  conv.data     = { service, chosenDay: targetDate.getTime(), chosenSlot: slot };

  if (history.name) {
    conv.data.clientName = history.name;
    conv.stage = "confirming";
    saveConversation(phone, conv);
    return `Encontrei o horário! ✅\n\n✂️ ${service.name} — R$${service.price}\n📅 ${formatDay(targetDate.getTime())}, ${formatTime(slot.start)}\n\nConfirmo no nome de *${history.name}*?\n\n1. ✅ Sim\n2. ✏️ Não, usar outro nome`;
  }

  conv.stage = "confirming";
  saveConversation(phone, conv);
  return `Encontrei o horário! ✅\n\n✂️ ${service.name} — R$${service.price}\n📅 ${formatDay(targetDate.getTime())}, ${formatTime(slot.start)}\n\nMe diz seu *nome completo* pra confirmar. 😊`;
}

function interpretarData(dataStr) {
  if (!dataStr) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  if (/amanh/i.test(dataStr)) {
    const d = new Date(hoje); d.setDate(hoje.getDate() + 1); return d;
  }

  const dias = ["domingo","segunda","terça","quarta","quinta","sexta","sábado","sabado"];
  for (let i = 0; i < dias.length; i++) {
    if (dataStr.toLowerCase().includes(dias[i])) {
      const alvo = i === 7 ? 6 : i;
      const diff = (alvo - hoje.getDay() + 7) % 7 || 7;
      const d = new Date(hoje); d.setDate(hoje.getDate() + diff); return d;
    }
  }

  const match = dataStr.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    const d = new Date(hoje.getFullYear(), parseInt(match[2]) - 1, parseInt(match[1]));
    if (d < hoje) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  return null;
}

function interpretarHorario(horarioStr) {
  if (!horarioStr) return null;
  const match = horarioStr.match(/(\d{1,2})(?::(\d{2}))?/);
  if (match) {
    let hora = parseInt(match[1]);
    if (hora < 8) hora += 12;
    return hora;
  }
  return null;
}

// ============================================================
//  FLUXO DE CONVERSA
// ============================================================

function processMessage(phone, text) {
  let conv = getConversation(phone);

  // Verifica inatividade
  if (conv.stage !== "greeting" && isConversationExpired(conv)) {
    clearConversation(phone);
    conv = { stage: "greeting", data: {}, lastActivity: Date.now() };
    sendWhatsApp(phone, "Sua conversa anterior foi encerrada por inatividade. Vamos começar de novo! 😊");
  }

  // Mensagem de encerramento
  if (/^(obrigado|obrigada|valeu|vlw|thanks|ok|👍|ótimo|otimo|perfeito|show|😊|🙏)$/i.test(text.trim())) {
    clearConversation(phone);
    return `De nada! 😄 Qualquer coisa é só chamar. Te esperamos na *${CONFIG.BARBERSHOP_NAME}*! ✂️`;
  }

  // Voltar ao menu (exceto durante cancelamento)
  const cancelStages = ["cancel_request", "cancel_confirm", "cancel_choose"];
  if (!cancelStages.includes(conv.stage) && /^(menu|voltar|inicio|início|sair)$/i.test(text.trim())) {
    clearConversation(phone);
    return handleGreeting(phone, text, { stage: "greeting", data: {} });
  }

  switch (conv.stage) {
    case "greeting":         return handleGreeting(phone, text, conv);
    case "choosing_action":  return handleActionChoice(phone, text, conv);
    case "answering_doubt":  return handleDoubt(phone, text, conv);
    case "choosing_service": return handleServiceChoice(phone, text, conv);
    case "choosing_day":     return handleDayChoice(phone, text, conv);
    case "choosing_time":    return handleTimeChoice(phone, text, conv);
    case "confirming":       return handleConfirmation(phone, text, conv);
    case "cancel_request":   return handleCancelRequest(phone, text, conv);
    case "cancel_confirm":   return handleCancelConfirm(phone, text, conv);
    case "cancel_choose":    return handleCancelChoose(phone, text, conv);
    default:
      clearConversation(phone);
      return handleGreeting(phone, text, { stage: "greeting", data: {} });
  }
}

function handleGreeting(phone, text, conv) {
  const history  = getClientHistory(phone);
  const lastBook = history.bookings.length > 0 ? history.bookings[history.bookings.length - 1] : null;

  conv.stage = "choosing_action";
  saveConversation(phone, conv);

  const greeting = history.name && lastBook
    ? `Olá, *${history.name}*! 😄 Que bom te ver por aqui!\n\nSeu último serviço foi *${lastBook.service}*.\n\n`
    : `Olá! 😄 Eu sou o assistente virtual da *${CONFIG.BARBERSHOP_NAME}*.\n\n`;

  return `${greeting}Como posso te ajudar hoje?\n\n1. 📅 Agendar horário\n2. ❌ Cancelar agendamento\n3. ❓ Tirar uma dúvida\n\nDigite o número da opção.\n\n_Digite *menu* a qualquer momento para voltar aqui._`;
}

function handleActionChoice(phone, text, conv) {
  const choice = parseInt(text.trim());

  if (choice === 1) {
    if (getBookingsThisMonth(phone) >= CONFIG.MAX_BOOKINGS_PER_MONTH) {
      clearConversation(phone);
      return `Você atingiu o limite de agendamentos do mês. Entre em contato diretamente com a barbearia. 😊`;
    }
    const serviceList = CONFIG.SERVICES.map((s, i) => `${i + 1}. ${s.name} — R$${s.price}`).join("\n");
    conv.stage = "choosing_service";
    saveConversation(phone, conv);
    return `Nossos serviços:\n\n${serviceList}\n\nQual vai ser? Digite o número. 👇`;
  }

  if (choice === 2) {
    conv.stage = "cancel_request";
    saveConversation(phone, conv);
    return `Para cancelar, me informa seu *nome completo*. 😊`;
  }

  if (choice === 3) {
    conv.stage = "answering_doubt";
    saveConversation(phone, conv);
    return `Claro! Qual é a sua dúvida? 😊`;
  }

  return `Digite 1, 2 ou 3 para escolher uma opção. 😊`;
}

function handleDoubt(phone, text, conv) {
  if (/agend|agendar|marcar/i.test(text)) {
    conv.stage = "choosing_action";
    saveConversation(phone, conv);
    return handleActionChoice(phone, "1", conv);
  }
  const resposta = askGemini(
    `Você é atendente da ${CONFIG.BARBERSHOP_NAME}. Responda a dúvida em 1-3 linhas, de forma simpática. Serviços: ${CONFIG.SERVICES.map(s => s.name + " R$" + s.price).join(", ")}. Se não souber, diga para ligar na barbearia.`,
    text
  );
  saveConversation(phone, conv);
  return resposta + "\n\nTem mais alguma dúvida ou quer agendar? 😊";
}

function handleServiceChoice(phone, text, conv) {
  const choice = parseInt(text.trim());
  if (isNaN(choice) || choice < 1 || choice > CONFIG.SERVICES.length) {
    return `Digite um número de 1 a ${CONFIG.SERVICES.length} pra escolher o serviço. 😊`;
  }

  const service = CONFIG.SERVICES[choice - 1];
  const days    = getAvailableDays(service);

  if (days.length === 0) {
    clearConversation(phone);
    return `Poxa, sem horários nos próximos ${CONFIG.DAYS_AHEAD} dias. Liga pra gente! 📞`;
  }

  conv.data.service      = service;
  conv.data.availableDays = days;
  conv.stage             = "choosing_day";
  saveConversation(phone, conv);

  return `Boa escolha! ✂️\n\nDias disponíveis:\n\n${days.map((d, i) => `${i + 1}. ${formatDay(d)}`).join("\n")}\n\nQual dia prefere?`;
}

function handleDayChoice(phone, text, conv) {
  const days   = conv.data.availableDays || [];
  const choice = parseInt(text.trim());
  if (isNaN(choice) || choice < 1 || choice > days.length) return `Digite um número de 1 a ${days.length}. 😊`;

  const chosenDay = days[choice - 1];
  const slots     = getAvailableSlotsForDay(chosenDay, conv.data.service);

  if (slots.length === 0) {
    return `Sem horários nesse dia. Escolha outro:\n\n${days.map((d, i) => `${i + 1}. ${formatDay(d)}`).join("\n")}`;
  }

  conv.data.chosenDay      = chosenDay;
  conv.data.availableSlots = slots;
  conv.stage               = "choosing_time";
  saveConversation(phone, conv);

  return `${formatDay(chosenDay)} — horários disponíveis:\n\n${slots.map((s, i) => `${i + 1}. ${formatTime(s.start)}`).join("\n")}\n\nQual prefere?`;
}

function handleTimeChoice(phone, text, conv) {
  const slots  = conv.data.availableSlots || [];
  const choice = parseInt(text.trim());
  if (isNaN(choice) || choice < 1 || choice > slots.length) return `Digite um número de 1 a ${slots.length}. 😊`;

  conv.data.chosenSlot = slots[choice - 1];
  conv.stage           = "confirming";

  const history = getClientHistory(phone);
  if (history.name) {
    conv.data.clientName = history.name;
    saveConversation(phone, conv);
    return `Confirmo o agendamento no nome de *${history.name}*?\n\n1. ✅ Sim, confirmar\n2. ✏️ Não, usar outro nome`;
  }

  saveConversation(phone, conv);
  return `Perfeito! Me diz seu *nome completo* pra confirmar. 😊`;
}

function handleConfirmation(phone, text, conv) {
  let name = "";

  if (conv.data.clientName && /^(1|sim|s|yes)$/i.test(text.trim())) {
    name = conv.data.clientName;
  } else if (conv.data.clientName && /^(2|não|nao|n|no)$/i.test(text.trim())) {
    conv.data.clientName = null;
    saveConversation(phone, conv);
    return `Ok! Me diz seu *nome completo*. 😊`;
  } else {
    name = text.trim();
    if (name.split(" ").length < 2) return `Preciso do seu *nome completo*. 😊`;
  }

  const slot    = conv.data.chosenSlot;
  const service = conv.data.service;

  try {
    bookSlot(slot, name, phone, service);
    recordBooking(phone, name, service, slot);
  } catch (err) {
    Logger.log("Erro ao agendar: " + err.stack);
    return "Ops, erro ao salvar. Tenta de novo em instantes. 🙏";
  }

  clearConversation(phone);
  return `✅ *Agendado!*\n\n👤 ${name}\n✂️ ${service.name} — R$${service.price}\n📅 ${formatDay(conv.data.chosenDay)}, ${formatTime(slot.start)}\n📍 ${CONFIG.BARBERSHOP_NAME}\n\nTe esperamos! Qualquer dúvida é só chamar. 😄`;
}

function handleCancelRequest(phone, text, conv) {
  const name = text.trim();
  if (name.split(" ").length < 2) return "Me informa seu *nome completo* para localizar o agendamento. 😊";

  conv.data.cancelName = name;
  conv.stage           = "cancel_confirm";
  saveConversation(phone, conv);
  return `Buscando seu agendamento... 🔍\n\nQual a *data e horário* que deseja cancelar?\n\nEx: _Segunda 12/05 às 10:00_`;
}

function handleCancelConfirm(phone, text, conv) {
  const name   = conv.data.cancelName;
  const cal    = CalendarApp.getCalendarById(CONFIG.BARBERS[0].calendarId);
  const now    = new Date();
  const end    = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const events = cal.getEvents(now, end).filter(ev => ev.getTitle().toLowerCase().includes(name.toLowerCase()));

  if (events.length === 0) {
    clearConversation(phone);
    return `Não encontrei agendamento no nome de *${name}*. Verifique o nome ou ligue pra barbearia. 📞`;
  }

  if (events.length === 1) {
    const ev      = events[0];
    const dateStr = `${formatDay(ev.getStartTime().getTime())} às ${formatTime(ev.getStartTime().getTime())}`;
    ev.deleteEvent();
    clearConversation(phone);
    return `✅ Agendamento cancelado!\n\n👤 ${name}\n📅 ${dateStr}\n\nSe quiser reagendar é só chamar! 😊`;
  }

  conv.data.cancelEvents = events.map(ev => ({ id: ev.getId(), start: ev.getStartTime().getTime(), title: ev.getTitle() }));
  conv.stage             = "cancel_choose";
  saveConversation(phone, conv);

  const list = events.map((ev, i) => `${i + 1}. ${formatDay(ev.getStartTime().getTime())} às ${formatTime(ev.getStartTime().getTime())}`).join("\n");
  return `Encontrei ${events.length} agendamentos para *${name}*:\n\n${list}\n\nQual deseja cancelar? Digite o número.`;
}

function handleCancelChoose(phone, text, conv) {
  const events = conv.data.cancelEvents || [];
  const choice = parseInt(text.trim());
  if (isNaN(choice) || choice < 1 || choice > events.length) return `Digite um número de 1 a ${events.length}. 😊`;

  const chosen = events[choice - 1];
  const event  = CalendarApp.getCalendarById(CONFIG.BARBERS[0].calendarId).getEventById(chosen.id);
  if (event) event.deleteEvent();

  clearConversation(phone);
  return `✅ Agendamento cancelado!\n\n👤 ${conv.data.cancelName}\n📅 ${formatDay(chosen.start)} às ${formatTime(chosen.start)}\n\nSe quiser reagendar é só chamar! 😊`;
}

// ============================================================
//  GOOGLE AGENDA
// ============================================================

function getAvailableDays(service) {
  const days = [];
  const now  = new Date();

  for (let i = 0; i < CONFIG.DAYS_AHEAD; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    date.setHours(0, 0, 0, 0);

    const schedule = CONFIG.SCHEDULE[date.getDay()];
    if (!schedule?.open || isDayClosed(date)) continue;
    if (getAvailableSlotsForDay(date.getTime(), service).length > 0) days.push(date.getTime());
  }
  return days;
}

function isDayClosed(date) {
  try {
    const cal      = CalendarApp.getCalendarById(CONFIG.BARBERS[0].calendarId);
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 0);
    return cal.getEvents(dayStart, dayEnd).some(ev => {
      const t = ev.getTitle().toLowerCase();
      return t.includes("fechado") || t.includes("feriado");
    });
  } catch (e) { return false; }
}

function getAvailableSlotsForDay(dayTimestamp, service) {
  const date     = new Date(dayTimestamp);
  const schedule = CONFIG.SCHEDULE[date.getDay()];
  if (!schedule?.open) return [];

  const special    = getSpecialHours(date);
  const startHour  = special ? special.start : schedule.start;
  const endHour    = special ? special.end   : schedule.end;
  const duration   = service?.duration || CONFIG.SLOT_DURATION;
  const slots      = [];

  CONFIG.BARBERS.forEach(barber => {
    const cal = CalendarApp.getCalendarById(barber.calendarId);
    if (!cal) return;

    const dayStart = new Date(date); dayStart.setHours(startHour, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(endHour, 0, 0, 0);

    const busyTimes = cal.getEvents(dayStart, dayEnd)
      .filter(ev => {
        const t = ev.getTitle().toLowerCase();
        return !t.includes("feriado") && !t.includes("fechado") && !t.includes("horário especial");
      })
      .map(ev => ({ start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() }));

    let slotStart = new Date(dayStart);
    while (slotStart.getTime() + duration * 60000 <= dayEnd.getTime()) {
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);
      if (slotStart.getTime() > Date.now() + 30 * 60000) {
        const isBusy = busyTimes.some(b => slotStart.getTime() < b.end && slotEnd.getTime() > b.start);
        if (!isBusy) slots.push({ start: slotStart.getTime(), end: slotEnd.getTime(), barberId: barber.calendarId, barberName: barber.name });
      }
      slotStart = new Date(slotStart.getTime() + CONFIG.SLOT_DURATION * 60000);
    }
  });

  return slots.sort((a, b) => a.start - b.start);
}

function getSpecialHours(date) {
  try {
    const cal      = CalendarApp.getCalendarById(CONFIG.BARBERS[0].calendarId);
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 0);
    for (const ev of cal.getEvents(dayStart, dayEnd)) {
      const match = ev.getTitle().match(/horário especial\s+(\d+)-(\d+)/i);
      if (match) return { start: parseInt(match[1]), end: parseInt(match[2]) };
    }
  } catch (e) {}
  return null;
}

function bookSlot(slot, clientName, phone, service) {
  CalendarApp.getCalendarById(slot.barberId).createEvent(
    `✂️ ${clientName} — ${service.name}`,
    new Date(slot.start),
    new Date(slot.end),
    {
      description: `Cliente: ${clientName}\nWhatsApp: ${phone}\nServiço: ${service.name}\nValor: R$${service.price}`,
      color: CalendarApp.EventColor.GREEN,
    }
  );
}

// ============================================================
//  GEMINI
// ============================================================

function askGemini(system, userText) {
  return callGemini([
    { role: "user",  parts: [{ text: system }] },
    { role: "model", parts: [{ text: "Entendido!" }] },
    { role: "user",  parts: [{ text: userText }] },
  ]);
}

function callGemini(messages, attempt) {
  attempt = attempt || 1;
  const res = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify({ contents: messages }),
      muteHttpExceptions: true,
    }
  );

  const code = res.getResponseCode();
  const data = JSON.parse(res.getContentText());

  if (code === 503 && attempt < 3) {
    Utilities.sleep(3000);
    return callGemini(messages, attempt + 1);
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Desculpe, não entendi. Pode repetir?";
}

// ============================================================
//  EVOLUTION API
// ============================================================

function sendWhatsApp(to, message) {
  UrlFetchApp.fetch(
    `${CONFIG.EVOLUTION_API_URL}/message/sendText/${CONFIG.EVOLUTION_INSTANCE}`,
    {
      method: "POST",
      contentType: "application/json",
      headers: { "apikey": CONFIG.EVOLUTION_API_KEY },
      payload: JSON.stringify({ number: to, text: message }),
      muteHttpExceptions: true,
    }
  );
}

// ============================================================
//  UTILITÁRIOS
// ============================================================

function formatDay(timestamp) {
  const date = new Date(timestamp);
  const dias = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  return `${dias[date.getDay()]} (${Utilities.formatDate(date, CONFIG.TIMEZONE, "dd/MM")})`;
}

function formatTime(timestamp) {
  return Utilities.formatDate(new Date(timestamp), CONFIG.TIMEZONE, "HH:mm");
}

// ============================================================
//  TESTES — rode no editor para validar o fluxo
// ============================================================

function testConversaCompleta() {
  const phone = "5511999999999@s.whatsapp.net";
  clearConversation(phone);
  ["Oi", "1", "1", "1", "1", "João Silva"].forEach(msg => {
    Logger.log("👤 " + msg);
    Logger.log("🤖 " + processMessage(phone, msg));
    Logger.log("---");
  });
}

function testClienteConhecido() {
  const phone = "5511999999999@s.whatsapp.net";
  saveClientHistory(phone, { name: "João Silva", bookings: [{ date: new Date().toISOString(), service: "Corte", price: 45 }] });
  clearConversation(phone);
  ["Oi", "1", "1", "1", "1", "1"].forEach(msg => {
    Logger.log("👤 " + msg);
    Logger.log("🤖 " + processMessage(phone, msg));
    Logger.log("---");
  });
}

function testAudioInteligente() {
  const phone = "5511999999999@s.whatsapp.net";
  clearConversation(phone);
  const transcricao = "Oi, quero agendar um corte no dia 22/05 às 10 horas";
  Logger.log("🎤 " + transcricao);
  const intencao = extrairIntencaoCompleta(transcricao);
  Logger.log("Intenção: " + JSON.stringify(intencao));
  if (intencao.temTudo) Logger.log("🤖 " + agendarDireto(phone, intencao));
  else Logger.log("❌ Informações insuficientes");
}

function testAgenda() {
  const cal = CalendarApp.getCalendarById(CONFIG.BARBERS[0].calendarId);
  if (!cal) { Logger.log("❌ Agenda não encontrada!"); return; }
  Logger.log("✅ Agenda: " + cal.getName());
  const now = new Date();
  cal.getEvents(now, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))
     .forEach(ev => Logger.log(" - " + ev.getTitle() + " | " + ev.getStartTime()));
}

function limparConversa() {
  // Substitua pelo número que deseja limpar
  clearConversation("5511999999999@s.whatsapp.net");
  Logger.log("Conversa limpa!");
}

function limparTodasConversas() {
  const props = PropertiesService.getScriptProperties();
  let count = 0;
  props.getKeys().forEach(key => { if (key.startsWith("conv_")) { props.deleteProperty(key); count++; } });
  Logger.log("Conversas limpas: " + count);
}
