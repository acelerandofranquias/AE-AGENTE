const Redis = require('ioredis');

const MAX_HISTORY = 50;
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias
const SPECIALIST_TTL = 60 * 60 * 24 * 7; // 7 dias

const redis = new Redis(process.env.REDIS_URL);

redis.on('error', (err) => console.error('[Memory] Redis error:', err.message));
redis.on('connect', () => console.log('[Memory] Redis conectado'));

function key(phone) {
  return `conversation:${phone}`;
}

async function getHistory(phone) {
  const data = await redis.get(key(phone));
  return data ? JSON.parse(data) : [];
}

async function addMessage(phone, role, content) {
  const history = await getHistory(phone);
  history.push({ role, content });

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  await redis.setex(key(phone), TTL_SECONDS, JSON.stringify(history));
}

async function clearHistory(phone) {
  await redis.del(key(phone));
}

async function getLeadSummary(phone, maxMessages = 10) {
  const history = await getHistory(phone);
  const recent = history.slice(-maxMessages);
  return recent
    .map(m => `${m.role === 'user' ? 'Lead' : 'Agente'}: ${m.content.substring(0, 300)}`)
    .join('\n');
}

function specialistKey(phone) {
  return `specialist_active:${phone}`;
}

async function isSpecialistActive(phone) {
  const val = await redis.exists(specialistKey(phone));
  return val === 1;
}

async function setSpecialistActive(phone) {
  await redis.setex(specialistKey(phone), SPECIALIST_TTL, '1');
}

async function clearSpecialistActive(phone) {
  await redis.del(specialistKey(phone));
}

module.exports = { getHistory, addMessage, clearHistory, getLeadSummary, isSpecialistActive, setSpecialistActive, clearSpecialistActive };
