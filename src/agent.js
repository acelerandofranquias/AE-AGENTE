// agent.js - Lógica principal do agente Lia
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./prompt');
const { getHistory, addMessage, getLeadSummary, setSpecialistActive } = require('./memory');
const { sendText, sendDocumentBase64, sendImage, sendAudio } = require('./zapi');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MATERIALS_URL = 'https://franquias.acelerandofranquias.com.br/alugue-estetica-franquia-qualificacao';
const VIDEO_URL = 'https://youtube.com/shorts/igQXnjOZokc?si=IMTLyabDjUxVDFm5';

// Processa as tags de ação que o Claude inclui nas respostas
async function processActions(phone, responseText) {
  const actions = [];

  if (responseText.includes('[ENVIAR_APRESENTACAO]')) {
    actions.push('enviar_apresentacao');
  }

  if (responseText.includes('[ENVIAR_VIDEO]')) {
    actions.push('enviar_video');
  }

  if (responseText.includes('[TRANSFERIR_LEAD]')) {
    actions.push('transferir');
  }

  const cleanText = responseText
    .replace(/\[ENVIAR_APRESENTACAO\]/g, '')
    .replace(/\[ENVIAR_VIDEO\]/g, '')
    .replace(/\[TRANSFERIR_LEAD\]/g, '')
    .trim();

  return { cleanText, actions };
}

// Envia os materiais oficiais (link da franqueadora)
async function sendMaterials(phone) {
  await new Promise(resolve => setTimeout(resolve, 800));
  await sendText(phone, `Aqui estão os materiais oficiais 👇\n${MATERIALS_URL}`);
}

// Envia o vídeo explicativo (quando lead quer saber mais)
async function sendVideo(phone) {
  await new Promise(resolve => setTimeout(resolve, 800));
  await sendText(phone, `Esse vídeo mostra como funciona na prática 👇\n${VIDEO_URL}`);
}

// Notifica o especialista sobre o lead quente com resumo completo da conversa
async function notifySpecialist(leadPhone) {
  const specialistPhone = process.env.SPECIALIST_PHONE;
  const specialistName = process.env.SPECIALIST_NAME || 'Consultor';
  const summary = await getLeadSummary(leadPhone);

  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const notification =
    `🔥 *LEAD QUENTE — ${process.env.BRAND_NAME || 'Alugue Estética'}*\n\n` +
    `📱 *Contato:* ${leadPhone}\n` +
    `🕐 *Transferido em:* ${hora}\n\n` +
    `📝 *Histórico completo da conversa:*\n\n${summary}\n\n` +
    `---\n⚡ Lead qualificado pelo agente. Pronto para atendimento.`;

  await sendText(specialistPhone, notification);
  console.log(`[Agent] Especialista ${specialistName} notificado — lead ${leadPhone}`);
}

// Função principal — processa mensagem do lead
async function processMessage(phone, userMessage) {
  console.log(`[Agent] Processando mensagem de ${phone}: ${userMessage.substring(0, 50)}...`);

  // Adiciona mensagem do usuário ao histórico
  await addMessage(phone, 'user', userMessage);

  const history = await getHistory(phone);

  try {
    // Chama o Claude com o histórico completo
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });

    const rawResponse = response.content[0].text;
    const { cleanText, actions } = await processActions(phone, rawResponse);

    // Adiciona resposta ao histórico (sem as tags)
    await addMessage(phone, 'assistant', cleanText);

    // Envia resposta principal
    if (cleanText) {
      // Divide mensagens longas em partes (WhatsApp fica melhor assim)
      const parts = splitMessage(cleanText);
      for (const part of parts) {
        await sendText(phone, part);
        if (parts.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
    }

    // Executa ações identificadas
    for (const action of actions) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (action === 'enviar_apresentacao') {
        await sendMaterials(phone);
      }

      if (action === 'enviar_video') {
        await sendVideo(phone);
      }

      if (action === 'transferir') {
        await notifySpecialist(phone);
        if (isBusinessHours()) {
          await sendText(phone,
            `✨ Já avisei nosso especialista sobre nossa conversa!\n` +
            `Ele vai entrar em contato em breve. 😊`
          );
        } else {
          await sendText(phone,
            `✨ Já avisei nosso especialista!\n\n` +
            `Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. ` +
            `Ele vai entrar em contato ${nextBusinessDayMessage()}. 😊`
          );
        }
        // Agente se silencia automaticamente após transferir
        await setSpecialistActive(phone);
        console.log(`[Agent] Agente silenciado para ${phone} após transferência`);
      }
    }

  } catch (error) {
    console.error('[Agent] Erro ao processar mensagem:', error.message);
    await sendText(phone,
      'Desculpe, tive um problema técnico agora. Pode repetir sua mensagem? 🙏'
    );
  }
}

// Verifica horário comercial (seg-sex 8h-18h, fuso Brasília UTC-3)
function isBusinessHours() {
  const now = new Date();
  const brasilia = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const hour = brasilia.getUTCHours();
  const day = brasilia.getUTCDay(); // 0=dom, 6=sáb
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

function nextBusinessDayMessage() {
  const now = new Date();
  const brasilia = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const day = brasilia.getUTCDay();
  if (day === 5 || day === 6) return 'na segunda-feira a partir das 8h';
  return 'amanhã a partir das 8h';
}

// Divide mensagens longas em partes menores (máx 1000 chars)
function splitMessage(text, maxLength = 1000) {
  if (text.length <= maxLength) return [text];

  const parts = [];
  const paragraphs = text.split('\n\n');
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + paragraph).length > maxLength && current) {
      parts.push(current.trim());
      current = paragraph;
    } else {
      current += (current ? '\n\n' : '') + paragraph;
    }
  }

  if (current) parts.push(current.trim());
  return parts;
}

module.exports = { processMessage };
