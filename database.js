import pkg from 'pg';
const { Pool } = pkg;

// Pool PostgreSQL pour Render
const pgPool = new Pool({
  host: 'dpg-d3bqc524d50c73c11chg-a.frankfurt-postgres.render.com',
  port: 5432,
  user: 'harrisw',
  password: 'tGwJuqx6jRLYS8r4RCa9fGeYxpwzYTdU',
  database: 'ummati',
  ssl: { rejectUnauthorized: false }, // Important pour Render
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Ping automatique toutes les 5 minutes
setInterval(async () => {
  try {
    await pgPool.query('SELECT 1');
    // console.log('PostgreSQL keep-alive ping');
  } catch (err) {
    console.error('Erreur PostgreSQL keep-alive ping:', err);
  }
}, 5 * 60 * 1000);

// Fonction pour synchroniser un utilisateur vers la base PostgreSQL via API
const SQL_API_URL = process.env.SQL_API_URL || (process.env.NODE_ENV === 'production'
  ? 'https://appislamic-sql.onrender.com/api/users'
  : 'http://localhost:3000/api/users');

export const syncUserToPostgres = async (googleId, name, email) => {
  try {
    console.log('[SYNC] Tentative de synchro PostgreSQL pour', email, 'via', SQL_API_URL);
    const response = await fetch(SQL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        username: name,
        preferences: {
          theme: 'default',
          arabicFont: 'Amiri',
          arabicFontSize: '2.5rem',
          reciter: 'mishary_rashid_alafasy'
        }
      })
    });
    const result = await response.json();
    console.log('[SYNC] Réponse PostgreSQL:', result);
    if (response.ok && result.user && result.user.id) {
      try {
        await fetch(SQL_API_URL.replace('/users', '/stats'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: result.user.id,
            hasanat: 0,
            verses: 0,
            time: 0,
            pages: 0
          })
        });
        console.log('✅ Stats initialisées à 0 pour l\'utilisateur PostgreSQL:', result.user.id);
      } catch (err) {
        console.error('❌ Erreur lors de l\'initialisation des stats:', err);
      }
      return result.user.id;
    } else {
      console.error('[SYNC] Erreur PostgreSQL:', result);
      return null;
    }
  } catch (error) {
    console.error('[SYNC] Erreur réseau:', error);
    return null;
  }
};

// ---------------------------- USERS ----------------------------
export async function findOrCreateUser(googleId, username, email) {
  let res = await pgPool.query('SELECT * FROM users WHERE id = $1', [googleId]);
  if (res.rows.length > 0) {
    const user = res.rows[0];
    if (user.chatbotmessagesused == null) {
      await pgPool.query('UPDATE users SET chatbotmessagesused = 0 WHERE id = $1', [googleId]);
    }
    if (user.chatbotmessagesquota == null) {
      await pgPool.query('UPDATE users SET chatbotmessagesquota = 1000 WHERE id = $1', [googleId]);
    }
    res = await pgPool.query('SELECT * FROM users WHERE id = $1', [googleId]);
    const userFinal = res.rows[0];
    userFinal.isAdmin = !!userFinal.isadmin;
    return userFinal;
  }

  await pgPool.query(
    'INSERT INTO users (id, email, username, chatbotmessagesused, chatbotmessagesquota) VALUES ($1, $2, $3, 0, 1000)',
    [googleId, email, username]
  );

  res = await pgPool.query('SELECT * FROM users WHERE id = $1', [googleId]);
  const userFinal = res.rows[0];
  userFinal.isAdmin = (userFinal.email === 'mohammadharris200528@gmail.com');
  return userFinal;
}

export async function findUserById(id) {
  try {
    const res = await pgPool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!res.rows[0]) return null;
    const user = res.rows[0];
    user.isAdmin = (user.email === 'mohammadharris200528@gmail.com');
    return user;
  } catch (err) {
    console.error('Erreur PostgreSQL findUserById:', err);
    return null;
  }
}

export async function checkGlobalChatbotQuota(userId, email) {
  if (email === 'mohammadharris200528@gmail.com') {
    return { canSend: true, remaining: Infinity };
  }
  const res = await pgPool.query(
    'SELECT chatbotmessagesused, chatbotmessagesquota FROM users WHERE id = $1',
    [userId]
  );
  if (!res.rows[0]) return { canSend: false, remaining: 0 };
  const user = res.rows[0];
  const remaining = (user.chatbotmessagesquota ?? 1000) - (user.chatbotmessagesused ?? 0);
  return { canSend: remaining > 0, remaining };
}

export async function incrementChatbotMessagesUsed(userId) {
  await pgPool.query(
    'UPDATE users SET chatbotmessagesused = COALESCE(chatbotmessagesused,0) + 1 WHERE id = $1',
    [userId]
  );
}

// ---------------------------- STATS ----------------------------
export async function getUserStats(userId) {
  const res = await pgPool.query(
    `SELECT 
      COALESCE(SUM(hasanat), 0) as hasanat,
      COALESCE(SUM(verses), 0) as verses,
      COALESCE(SUM(time_seconds), 0) as time_seconds,
      COALESCE(SUM(pages_read), 0) as pages_read
    FROM quran_stats
    WHERE user_id = $1`,
    [userId]
  );
  return res.rows[0];
}

// ---------------------------- CONVERSATIONS ----------------------------
export async function updateConversationTitle(userId, botId, conversationId, title) {
  const res = await pgPool.query(
    'UPDATE conversations SET title = $1, updatedat = NOW() WHERE id = $2 AND userid = $3 AND botid = $4',
    [title, conversationId, userId, botId]
  );
  return res.rowCount > 0;
}

export async function deleteConversation(userId, botId, conversationId) {
  const res = await pgPool.query(
    'DELETE FROM conversations WHERE id = $1 AND userid = $2 AND botid = $3',
    [conversationId, userId, botId]
  );
  return res.rowCount > 0;
}

export async function getConversationsForUserBot(userId, botId) {
  const res = await pgPool.query(
    'SELECT * FROM conversations WHERE userid = $1 AND botid = $2',
    [userId, botId]
  );
  return res.rows;
}

export async function getBotById(botId) {
  const res = await pgPool.query('SELECT * FROM bots WHERE id = $1', [botId]);
  return res.rows[0];
}

export async function getMessagesForUserBot(userId, botId, conversationId = 0, limit = 10) {
  let query = 'SELECT * FROM messages WHERE userid = $1 AND botid = $2';
  const params = [userId, botId];
  if (conversationId > 0) {
    query += ' AND conversationid = $3';
    params.push(conversationId);
  }
  query += ' ORDER BY timestamp DESC LIMIT $4';
  params.push(limit);
  const res = await pgPool.query(query, params);
  return res.rows.reverse();
}

export async function getUserBotPreferences(userId, botId) {
  const res = await pgPool.query(
    'SELECT * FROM user_bot_preferences WHERE userid = $1 AND botid = $2',
    [userId, botId]
  );
  return res.rows[0] || null;
}

// ---------------------------- QUIZ ----------------------------
export async function saveQuizResult(userId, theme, level, score, total, details = null, quiz_id) {
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pgPool.query(
    'INSERT INTO quiz_results (user_id, quiz_id, theme, level, score, total, date, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [userId, quiz_id, theme, level, score, total, date, details ? JSON.stringify(details) : null]
  );
}

export async function getQuizResultsForUser(userId) {
  const res = await pgPool.query(
    'SELECT * FROM quiz_results WHERE user_id = $1 ORDER BY date DESC',
    [userId]
  );
  return res.rows;
}

// ---------------------------- MAINTENANCE ----------------------------
export async function setMaintenance(enabled, id = '', pwd = '') {
  await pgPool.query(
    'UPDATE maintenance SET enabled = $1, admin_id = $2, admin_pwd = $3 WHERE id = 1',
    [!!enabled, id, pwd]
  );
}

export async function getMaintenance() {
  const res = await pgPool.query(
    'SELECT enabled, admin_id, admin_pwd FROM maintenance WHERE id = 1'
  );
  if (!res.rows[0]) return { enabled: false, id: '', pwd: '' };
  return { enabled: !!res.rows[0].enabled, id: res.rows[0].admin_id || '', pwd: res.rows[0].admin_pwd || '' };
}

// ---------------------------- EXPORT ----------------------------
export { pgPool, syncUserToPostgres };
