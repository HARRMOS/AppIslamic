import pkg from 'pg';
const { Pool } = pkg;

// -------------------- CONFIGURATION POSTGRES --------------------
export const pgPool = new Pool({
  host: process.env.PG_HOST || 'dpg-d3bqc524d50c73c11chg-a.frankfurt-postgres.render.com',
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || 'harrisw',
  password: process.env.PG_PASSWORD || 'tGwJuqx6jRLYS8r4RCa9fGeYxpwzYTdU',
  database: process.env.PG_DB || 'ummati',
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// -------------------- UTILISATEURS --------------------
export async function findOrCreateUser(googleId, username, email) {
  try {
    const res = await pgPool.query('SELECT * FROM users WHERE id = $1', [googleId]);
    if (res.rows.length > 0) {
      const user = res.rows[0];
      if (user.chatbotmessagesused === null) {
        await pgPool.query('UPDATE users SET chatbotMessagesUsed = 0 WHERE id = $1', [googleId]);
      }
      if (user.chatbotmessagesquota === null) {
        await pgPool.query('UPDATE users SET chatbotMessagesQuota = 1000 WHERE id = $1', [googleId]);
      }
      const updated = await pgPool.query('SELECT * FROM users WHERE id = $1', [googleId]);
      const userFinal = updated.rows[0];
      userFinal.isadmin = !!userFinal.isadmin;
      return userFinal;
    }
    await pgPool.query(
      'INSERT INTO users (id, email, username, chatbotMessagesUsed, chatbotMessagesQuota) VALUES ($1, $2, $3, 0, 1000)',
      [googleId, email, username]
    );
    const newUser = await pgPool.query('SELECT * FROM users WHERE id = $1', [googleId]);
    const userFinal = newUser.rows[0];
    userFinal.isadmin = (userFinal.email === 'mohammadharris200528@gmail.com');
    return userFinal;
  } catch (err) {
    console.error('Erreur findOrCreateUser Postgres:', err);
    return null;
  }
}

export async function findUserById(id) {
  try {
    const res = await pgPool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!res.rows[0]) return null;
    const user = res.rows[0];
    user.isadmin = (user.email === 'mohammadharris200528@gmail.com');
    return user;
  } catch (err) {
    console.error('Erreur findUserById Postgres:', err);
    return null;
  }
}

export async function checkGlobalChatbotQuota(userId, email) {
  if (email === 'mohammadharris200528@gmail.com') return { canSend: true, remaining: Infinity };
  const res = await pgPool.query('SELECT chatbotMessagesUsed, chatbotMessagesQuota FROM users WHERE id = $1', [userId]);
  if (!res.rows[0]) return { canSend: false, remaining: 0 };
  const user = res.rows[0];
  const remaining = (user.chatbotmessagesquota ?? 1000) - (user.chatbotmessagesused ?? 0);
  return { canSend: remaining > 0, remaining };
}

export async function incrementChatbotMessagesUsed(userId) {
  await pgPool.query('UPDATE users SET chatbotMessagesUsed = COALESCE(chatbotMessagesUsed,0) + 1 WHERE id = $1', [userId]);
}

// -------------------- STATS QURAN --------------------
export async function getUserStats(userId) {
  const res = await pgPool.query(
    `SELECT 
      COALESCE(SUM(hasanat), 0) AS hasanat,
      COALESCE(SUM(verses), 0) AS verses,
      COALESCE(SUM(time_seconds), 0) AS time_seconds,
      COALESCE(SUM(pages_read), 0) AS pages_read
    FROM quran_stats
    WHERE user_id = $1`, [userId]
  );
  return res.rows[0];
}

// -------------------- CONVERSATIONS --------------------
export async function updateConversationTitle(userId, botId, conversationId, title) {
  const res = await pgPool.query(
    'UPDATE conversations SET title = $1, updatedAt = NOW() WHERE id = $2 AND userId = $3 AND botId = $4',
    [title, conversationId, userId, botId]
  );
  return res.rowCount > 0;
}

export async function deleteConversation(userId, botId, conversationId) {
  const res = await pgPool.query(
    'DELETE FROM conversations WHERE id = $1 AND userId = $2 AND botId = $3',
    [conversationId, userId, botId]
  );
  return res.rowCount > 0;
}

export async function getConversationsForUserBot(userId, botId) {
  const res = await pgPool.query('SELECT * FROM conversations WHERE userId = $1 AND botId = $2', [userId, botId]);
  return res.rows;
}

export async function getBotById(botId) {
  const res = await pgPool.query('SELECT * FROM bots WHERE id = $1', [botId]);
  return res.rows[0];
}

export async function getMessagesForUserBot(userId, botId, conversationId = 0, limit = 10) {
  let query = 'SELECT * FROM messages WHERE userId = $1 AND botId = $2';
  const params = [userId, botId];
  if (conversationId > 0) {
    query += ' AND conversationId = $3';
    params.push(conversationId);
  }
  query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1);
  params.push(limit);
  const res = await pgPool.query(query, params);
  return res.rows.reverse();
}

export async function getUserBotPreferences(userId, botId) {
  const res = await pgPool.query('SELECT * FROM user_bot_preferences WHERE userId = $1 AND botId = $2', [userId, botId]);
  return res.rows[0] || null;
}

// -------------------- QUIZ --------------------
export async function saveQuizResult(userId, theme, level, score, total, details = null, quiz_id) {
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pgPool.query(
    'INSERT INTO quiz_results (user_id, quiz_id, theme, level, score, total, date, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [userId, quiz_id, theme, level, score, total, date, details ? JSON.stringify(details) : null]
  );
}

export async function getQuizResultsForUser(userId) {
  const res = await pgPool.query('SELECT * FROM quiz_results WHERE user_id = $1 ORDER BY date DESC', [userId]);
  return res.rows;
}

// -------------------- MAINTENANCE --------------------
export async function setMaintenance(enabled, id = '', pwd = '') {
  await pgPool.query(
    'UPDATE maintenance SET enabled = $1, admin_id = $2, admin_pwd = $3 WHERE id = 1',
    [!!enabled, id, pwd]
  );
}

export async function getMaintenance() {
  const res = await pgPool.query('SELECT enabled, admin_id, admin_pwd FROM maintenance WHERE id = 1');
  if (!res.rows[0]) return { enabled: false, id: '', pwd: '' };
  return { enabled: !!res.rows[0].enabled, id: res.rows[0].admin_id || '', pwd: res.rows[0].admin_pwd || '' };
}

// -------------------- SYNCHRO UTILISATEUR --------------------
export async function syncUserToPostgres(googleId, name, email) {
  const user = await findOrCreateUser(googleId, name, email);
  if (!user) return null;

  const stats = await pgPool.query('SELECT * FROM quran_stats WHERE user_id = $1', [user.id]);
  if (stats.rows.length === 0) {
    await pgPool.query(
      'INSERT INTO quran_stats (user_id, date, hasanat, verses, time_seconds, pages_read) VALUES ($1, CURRENT_DATE, 0, 0, 0, 0)',
      [user.id]
    );
  }
  return user.id;
}
