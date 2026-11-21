const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'medclinic_lab2',
  waitForConnections: true,
  connectionLimit: 10
});

// 1. Базова безпека HTTP-заголовків (налаштовано для роботи React CDN у браузері)
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

// Обмеження розміру JSON-тіла запиту (захист від перевантаження пам'яті)
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// 2. Простий in-memory Rate Limiter для POST-запитів (не більше 15 заявок за хвилину з одного IP)
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

// 3. Функція санітизації та валідації даних форми
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

  // Перевірка українського формату номера: +380XXXXXXXXX або 0XXXXXXXXX
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

// GET — отримати список усіх консультацій
app.get('/api/consultations', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM consultations ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// GET — деталі за ID
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

// POST — створення запису з повною валідацією та санітизацією
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

// PATCH — зміна статусу
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

// DELETE — видалення
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

app.listen(PORT, () => {
  console.log(`Сервер MedClinic (Lab 4 Security & Validation) запущено: http://localhost:${PORT}`);
});