require('dotenv').config();
const nodemailer = require('nodemailer');
const { checkConnection } = require('./zapi');

let wasConnected = true;
let alertSent = false;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.ALERT_EMAIL_USER,
    pass: process.env.ALERT_EMAIL_PASS,
  },
});

function getRecipients() {
  return (process.env.ALERT_EMAILS || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);
}

async function sendAlert(subject, body) {
  const to = getRecipients();
  if (!to.length) {
    console.warn('[Monitor] Nenhum email configurado em ALERT_EMAILS');
    return;
  }

  try {
    await transporter.sendMail({
      from: `"AE Agente Monitor" <${process.env.ALERT_EMAIL_USER}>`,
      to: to.join(', '),
      subject,
      text: body,
    });
    console.log(`[Monitor] Email enviado para: ${to.join(', ')}`);
  } catch (err) {
    console.error('[Monitor] Erro ao enviar email:', err.message);
  }
}

async function checkZApi() {
  try {
    const conn = await checkConnection();
    const connected = conn?.state === 'Connected' || conn?.connected === true;

    if (!connected && wasConnected && !alertSent) {
      wasConnected = false;
      alertSent = true;
      const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      await sendAlert(
        `🚨 ALERTA — Z-API Desconectada | ${process.env.BRAND_NAME}`,
        `A conexão do WhatsApp (Z-API) foi perdida.\n\n` +
        `Agente: ${process.env.AGENT_NAME}\n` +
        `Marca: ${process.env.BRAND_NAME}\n` +
        `Horário: ${hora}\n\n` +
        `Ação necessária: acesse o painel da Z-API e reconecte via QR Code.\n` +
        `Enquanto desconectado, nenhuma mensagem de lead está sendo processada.`
      );
    }

    if (connected && !wasConnected) {
      wasConnected = true;
      alertSent = false;
      const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      await sendAlert(
        `✅ Z-API Reconectada | ${process.env.BRAND_NAME}`,
        `A conexão do WhatsApp foi restaurada.\n\n` +
        `Agente: ${process.env.AGENT_NAME}\n` +
        `Marca: ${process.env.BRAND_NAME}\n` +
        `Horário: ${hora}\n\n` +
        `O agente está operacional novamente.`
      );
    }

  } catch (err) {
    console.error('[Monitor] Erro ao verificar conexão:', err.message);
  }
}

function startMonitor(intervalMinutes = 5) {
  console.log(`[Monitor] Monitoramento iniciado — check a cada ${intervalMinutes} min`);
  setInterval(checkZApi, intervalMinutes * 60 * 1000);
  checkZApi(); // check imediato ao iniciar
}

module.exports = { startMonitor };
