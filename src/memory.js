const Redis = require('ioredis');

const MAX_HISTORY = 20;
const TTL_SECONDS = 60 * 60 * 24 * 20; // 20 dias

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

async function getLeadSummary(phone) {
  const history = await getHistory(phone);
  return history
    .map(m => `${m.role === 'user' ? 'Lead' : 'Lia'}: ${m.content}`)
    .join('\n');
}

module.exports = { getHistory, addMessage, clearHistory, getLeadSummary };
