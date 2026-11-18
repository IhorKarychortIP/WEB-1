const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const app = express();
const PORT = process.env.PORT || 3000;

// Завантаження OpenAPI специфікації
const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'medclinic_lab2',
  waitForConnections: true,
  connectionLimit: 10
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Документація OpenAPI (Swagger UI)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// 1. GET — отримати список усіх консультацій (підтримує фільтр ?specialty=...)
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
    res.status(500).json({ error: err.message });
  }
});

// 2. GET — отримати одну консультацію за ID
app.get('/api/consultations/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM consultations WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Консультацію не знайдено' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST — записати пацієнта на консультацію
app.post('/api/consultations', async (req, res) => {
  const { patient_name, doctor_specialty, appointment_date } = req.body;
  if (!patient_name || !doctor_specialty || !appointment_date) {
    return res.status(400).json({ error: 'Обов’язкові поля: patient_name, doctor_specialty, appointment_date' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO consultations (patient_name, doctor_specialty, appointment_date) VALUES (?, ?, ?)',
      [patient_name.trim(), doctor_specialty, appointment_date]
    );
    const [rows] = await pool.query('SELECT * FROM consultations WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PATCH — підтвердити або повернути консультацію в очікування
app.patch('/api/consultations/:id/confirm', async (req, res) => {
  try {
    const [updateResult] = await pool.query(
      "UPDATE consultations SET status = IF(status = 'pending', 'confirmed', 'pending') WHERE id = ?",
      [req.params.id]
    );
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Консультацію не знайдено' });
    }
    const [rows] = await pool.query('SELECT * FROM consultations WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE — скасувати та видалити запис
app.delete('/api/consultations/:id', async (req, res) => {
  try {
    const [deleteResult] = await pool.query('DELETE FROM consultations WHERE id = ?', [req.params.id]);
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Консультацію не знайдено' });
    }
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер MedClinic запущено: http://localhost:${PORT}`);
  console.log(`OpenAPI (Swagger UI): http://localhost:${PORT}/api-docs`);
});