const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Завантаження OpenAPI специфікації
const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));

// Конфігурація пулу MySQL (підтримує локальний запуск і хмарні БД із портом та SSL)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'medclinic_lab2',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10
});

// Автоматична ініціалізація таблиці при старті сервера
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        patient_name VARCHAR(150) NOT NULL,
        patient_phone VARCHAR(20) NOT NULL DEFAULT '+380000000000',
        doctor_specialty VARCHAR(100) NOT NULL,
        appointment_date VARCHAR(50) NOT NULL,
        symptoms TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('База даних MySQL успішно підключена та готова до роботи.');
  } catch (err) {
    console.error('Помилка ініціалізації БД:', err.message);
  }
}

// 1. Базова безпека HTTP-заголовків
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

// Обмеження розміру JSON-тіла запиту
app.use(express.json({ limit: '10kb' }));

// 2. Middleware моніторингу продуктивності
const metrics = {
  totalRequests: 0,
  errorCount: 0,
  avgResponseTimeMs: 0
};

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  metrics.totalRequests += 1;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.avgResponseTimeMs = Number(
      ((metrics.avgResponseTimeMs * (metrics.totalRequests - 1) + durationMs) / metrics.totalRequests).toFixed(2)
    );
    if (res.statusCode >= 500) {
      metrics.errorCount += 1;
    }
  });

  next();
});

// Роздача статики фронтенду та інтерактивної документації Swagger UI
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// 3. Ендпоінт моніторингу продуктивності та стану сервісу (Health Check)
app.get('/api/health', async (req, res) => {
  const dbStart = process.hrtime.bigint();
  let dbStatus = 'connected';
  let dbLatencyMs = 0;

  try {
    await pool.query('SELECT 1');
    dbLatencyMs = Number((Number(process.hrtime.bigint() - dbStart) / 1e6).toFixed(2));
  } catch (err) {
    dbStatus = 'disconnected';
  }

  const mem = process.memoryUsage();
  const statusCode = dbStatus === 'connected' ? 200 : 503;

  res.status(statusCode).json({
    service: 'MedClinic Cloud API',
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    environment: process.env.NODE_ENV || 'production',
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs
    },
    performance: {
      totalRequests: metrics.totalRequests,
      serverErrors: metrics.errorCount,
      avgResponseTimeMs: metrics.avgResponseTimeMs,
      rssMemoryMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(2))
    },
    timestamp: new Date().toISOString()
  });
});

// 4. In-memory Rate Limiter для POST-запитів
const requestLog = new Map();
function postRateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= 15) {
    return res.status(429).json({ error: 'Забагато запитів. Спробуйте через хвилину.' });
  }
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  next();
}

// 5. Санітизація та валідація даних форми
const ALLOWED_SPECIALTIES = ['Терапевт', 'Кардіолог', 'Невролог', 'Офтальмолог', 'Дерматолог'];

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim();
}

function validateConsultationInput(body) {
  const errors = [];
  const patient_name = sanitizeText(body.patient_name);
  const patient_phone = sanitizeText(body.patient_phone);
  const doctor_specialty = sanitizeText(body.doctor_specialty);
  const appointment_date = sanitizeText(body.appointment_date);
  const symptoms = sanitizeText(body.symptoms);

  if (patient_name.length < 3 || patient_name.length > 100) {
    errors.push('ПІБ пацієнта має містити від 3 до 100 символів.');
  }

  const phoneRegex = /^(\+380|0)\d{9}$/;
  if (!phoneRegex.test(patient_phone.replace(/[\s()-]/g, ''))) {
    errors.push('Некоректний номер телефону (приклад: +380671234567 або 0671234567).');
  }

  if (!ALLOWED_SPECIALTIES.includes(doctor_specialty)) {
    errors.push('Обрано недопустиму спеціалізацію лікаря.');
  }

  if (!appointment_date || Number.isNaN(Date.parse(appointment_date))) {
    errors.push('Вкажіть коректну дату та час прийому.');
  }

  if (symptoms.length > 500) {
    errors.push('Опис симптомів не повинен перевищувати 500 символів.');
  }

  return {
    errors,
    cleanData: {
      patient_name,
      patient_phone: patient_phone.replace(/[\s()-]/g, ''),
      doctor_specialty,
      appointment_date,
      symptoms
    }
  };
}

// 6. Інтеграція Google Gemini AI API (аналіз симптомів та чат-бот реєстратури)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-4-hydrogen',
  'gemini-3.8-flash'
];

async function callGemini(promptText, systemInstruction) {
  if (!GEMINI_API_KEY) {
    throw new Error('На сервері не налаштовано змінну середовища GEMINI_API_KEY.');
  }

  let lastError = '';

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: promptText }]
            }
          ],
          generationConfig: {
            temperature: 0.4
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Не вдалося сформувати відповідь.';
      }

      lastError = `Помилка Gemini API (${response.status}) на моделі ${model}`;
      // Якщо перевантаження (503), ліміт (429) або недоступність моделі (404) — йдемо до наступної
      if (![404, 429, 503].includes(response.status)) {
        const errText = await response.text();
        throw new Error(`${lastError}: ${errText}`);
      }
    } catch (err) {
      lastError = err.name === 'TimeoutError'
        ? `Таймаут відповіді від ${model}`
        : `Мережева помилка на ${model}: ${err.message}`;
      continue;
    }
      throw err;
    }

  throw new Error(`${lastError}. Усі моделі тимчасово перевантажені, спробуйте за кілька секунд.`);
}

app.post('/api/ai/analyze-symptoms', postRateLimiter, async (req, res) => {
  const symptoms = sanitizeText(req.body.symptoms);
  if (symptoms.length < 5) {
    return res.status(400).json({ error: 'Опишіть симптоми детальніше (мінімум 5 символів) для AI-аналізу.' });
  }

  const systemPrompt = `Ти медичний AI-асистент електронної реєстратури MedClinic.
Проаналізуй скарги пацієнта та поверни відповідь СУВОРО у форматі JSON без markdown-обгорток:
{
  "recommended_specialty": "одне зі значень: Терапевт, Кардіолог, Невролог, Офтальмолог, Дерматолог",
  "urgency": "Планово або Терміново",
  "advice": "коротка рекомендація до 2 речень українською мовою без постановки діагнозу"
}`;

  try {
    const rawReply = await callGemini(`Скарги пацієнта: ${symptoms}`, systemPrompt);
    const cleanedJson = rawReply.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanedJson);

    if (!ALLOWED_SPECIALTIES.includes(parsed.recommended_specialty)) {
      parsed.recommended_specialty = 'Терапевт';
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/chat', postRateLimiter, async (req, res) => {
  const message = sanitizeText(req.body.message);
  if (!message) {
    return res.status(400).json({ error: 'Повідомлення не може бути порожнім.' });
  }

  const systemPrompt = `Ти ввічливий віртуальний консультант приватної поліклініки MedClinic.
Доступні спеціалісти: Терапевт, Кардіолог, Невролог, Офтальмолог, Дерматолог.
Графік роботи: Пн-Сб з 08:00 до 20:00.
Відповідай стисло, професійно українською мовою (до 3-4 речень). Не став медичних діагнозів і не призначай ліки — за потреби рекомендуй записатися на консультацію через форму на сайті.`;

  try {
    const reply = await callGemini(message, systemPrompt);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. REST API маршрути для роботи з консультаціями
app.get('/api/consultations', async (req, res) => {
  try {
    const { specialty } = req.query;
    if (specialty) {
      const [rows] = await pool.query(
        'SELECT * FROM consultations WHERE doctor_specialty = ? ORDER BY id DESC',
        [specialty]
      );
      return res.json(rows);
    }
    const [rows] = await pool.query('SELECT * FROM consultations ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

app.get('/api/consultations/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Некоректний ID запису' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM consultations WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Консультацію не знайдено' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

app.post('/api/consultations', postRateLimiter, async (req, res) => {
  const { errors, cleanData } = validateConsultationInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO consultations (patient_name, patient_phone, doctor_specialty, appointment_date, symptoms) VALUES (?, ?, ?, ?, ?)',
      [
        cleanData.patient_name,
        cleanData.patient_phone,
        cleanData.doctor_specialty,
        cleanData.appointment_date,
        cleanData.symptoms
      ]
    );
    const [rows] = await pool.query('SELECT * FROM consultations WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Помилка збереження у базу даних' });
  }
});

app.patch('/api/consultations/:id/confirm', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Некоректний ID запису' });
  }

  try {
    const [updateResult] = await pool.query(
      "UPDATE consultations SET status = IF(status = 'pending', 'confirmed', 'pending') WHERE id = ?",
      [id]
    );
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Консультацію не знайдено' });
    }
    const [rows] = await pool.query('SELECT * FROM consultations WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

app.delete('/api/consultations/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Некоректний ID запису' });
  }

  try {
    const [deleteResult] = await pool.query('DELETE FROM consultations WHERE id = ?', [id]);
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Консультацію не знайдено' });
    }
    res.json({ deleted: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Запуск сервера після ініціалізації БД
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Сервер MedClinic запущено на порту ${PORT}`);
    console.log(`OpenAPI (Swagger UI): http://localhost:${PORT}/api-docs`);
    console.log(`Health Check: http://localhost:${PORT}/api/health`);
  });
});