// server.js - Servidor principal
require('dotenv').config();
const express = require('express');
const { processMessage, transferToSpecialist } = require('./agent');
const { checkConnection } = require('./zapi');
const { isSpecialistActive, clearSpecialistActive, clearHistory, getHistory } = require('./memory');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================
// WEBHOOK - Z-API envia mensagens aqui
// ============================================
app.post('/webhook', async (req, res) => {
  // Responde 200 imediatamente para a Z-API não tentar reenviar
  res.status(200).json({ status: 'ok' });

  try {
    const body = req.body;

    // Log para debug — remove depois que estiver funcionando
    console.log('[Server] Webhook recebido:', JSON.stringify(body).substring(0, 200), '| deploy-test');

    // Mensagem enviada pelo próprio número = especialista assumiu
    if (body.fromMe) {
      if (body.phone && !await isSpecialistActive(body.phone)) {
        await transferToSpecialist(body.phone);
        console.log(`[Server] Especialista detectado via fromMe para ${body.phone}`);
      }
      return;
    }

    // Ignora mensagens de grupos
    if (body.isGroup) return;

    // Ignora se não tem telefone ou texto
    if (!body.phone) return;

    // Z-API envia o número já formatado
    const phone = body.phone;

    // Ignora números bloqueados (env BLOCKED_PHONES)
    const blockedPhones = (process.env.BLOCKED_PHONES || '').split(',').map(n => n.trim()).filter(Boolean);
    if (blockedPhones.includes(phone)) {
      console.log(`[Server] Número bloqueado ignorado: ${phone}`);
      return;
    }

    // Especialista já assumiu — agente silencia para esse lead
    if (await isSpecialistActive(phone)) {
      console.log(`[Server] Especialista ativo para ${phone} — agente silenciado`);
      return;
    }

    // Extrai o texto — Z-API usa body.text.message para texto simples
    let userMessage = '';

    if (body.type === 'ReceivedCallback') {
      if (body.text?.message) {
        userMessage = body.text.message;
      } else if (body.image?.caption) {
        // Lead enviou imagem com legenda — responde pedindo texto
        userMessage = '[imagem recebida]';
      } else if (body.document?.caption) {
        userMessage = '[documento recebido]';
      } else if (body.audio) {
        userMessage = '[áudio recebido]';
      } else {
        console.log(`[Server] Tipo de mensagem não tratado de ${phone}`);
        return;
      }
    } else {
      // Evento que não é mensagem recebida (status, etc.)
      return;
    }

    if (!userMessage.trim()) return;

    // Se recebeu mídia, avisa que só processa texto por enquanto
    if (['[imagem recebida]', '[documento recebido]', '[áudio recebido]'].includes(userMessage)) {
      const { sendText } = require('./zapi');
      await sendText(phone, 'Olá! Por enquanto só consigo processar mensagens de texto. Pode me escrever o que precisa? 😊');
      return;
    }

    console.log(`[Server] Mensagem de ${phone}: ${userMessage.substring(0, 80)}`);

    // Processa de forma assíncrona para não bloquear o webhook
    setImmediate(() => processMessage(phone, userMessage));

  } catch (error) {
    console.error('[Server] Erro no webhook:', error.message);
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', async (req, res) => {
  const connection = await checkConnection();
  res.json({
    status: 'running',
    agent: process.env.AGENT_NAME,
    brand: process.env.BRAND_NAME,
    whatsapp: connection?.state || 'unknown',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// CONTROLE MANUAL DO AGENTE (abrir no navegador)
// GET /pausar/:phone   — especialista assume, agente silencia
// GET /reativar/:phone — agente volta a responder
// ============================================
app.get('/pausar/:phone', async (req, res) => {
  const { phone } = req.params;
  await transferToSpecialist(phone);
  console.log(`[Server] Agente pausado via link para ${phone}`);
  res.send(`<h2>✅ Agente pausado para ${phone}</h2><p>Resumo enviado ao especialista. <a href="/reativar/${phone}">Clique aqui para reativar.</a></p>`);
});

app.get('/reativar/:phone', async (req, res) => {
  const { phone } = req.params;
  await clearSpecialistActive(phone);
  console.log(`[Server] Agente reativado para ${phone}`);
  res.send(`<h2>✅ Agente reativado para ${phone}</h2><p>O agente voltará a responder esse número.</p>`);
});

// ============================================
// VER HISTÓRICO DE CONVERSA
// GET /historico/:phone
// ============================================
app.get('/historico/:phone', async (req, res) => {
  const { phone } = req.params;
  const history = await getHistory(phone);

  if (!history.length) {
    return res.send(`<h2>Sem histórico para ${phone}</h2>`);
  }

  const linhas = history.map((m, i) => {
    const autor = m.role === 'user' ? '👤 Lead' : '🤖 Lia';
    const cor = m.role === 'user' ? '#f0f0f0' : '#dcf8c6';
    return `<div style="background:${cor};padding:10px;margin:6px 0;border-radius:8px;">
      <strong>${i + 1}. ${autor}</strong><br>${m.content.replace(/\n/g, '<br>')}
    </div>`;
  }).join('');

  res.send(`
    <html><body style="font-family:sans-serif;max-width:700px;margin:auto;padding:20px">
    <h2>Histórico — ${phone}</h2>
    <p>${history.length} mensagens</p>
    ${linhas}
    </body></html>
  `);
});

// ============================================
// RESETAR LEAD COMPLETO (para testes)
// GET /resetar/:phone — apaga histórico + flag de especialista
// ============================================
app.get('/resetar/:phone', async (req, res) => {
  const { phone } = req.params;
  await clearHistory(phone);
  await clearSpecialistActive(phone);
  console.log(`[Server] Lead ${phone} resetado para testes`);
  res.send(`<h2>✅ Lead ${phone} resetado</h2><p>Histórico apagado e agente reativado. A próxima mensagem inicia uma conversa nova.</p>`);
});

// ============================================
// START
// ============================================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   ${process.env.BRAND_NAME} Agent     
║   Agente: ${process.env.AGENT_NAME}                        
║   Porta: ${PORT}                              
║   Webhook: /webhook                    
║   Health: /health                      
╚════════════════════════════════════════╝
  `);
});
