const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

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

// GET — отримати список усіх консультацій
app.get('/api/consultations', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM consultations ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — записати пацієнта на консультацію
app.post('/api/consultations', async (req, res) => {
  const { patient_name, doctor_specialty, appointment_date } = req.body;
  if (!patient_name || !doctor_specialty || !appointment_date) {
    return res.status(400).json({ error: 'Заповніть усі поля форми' });
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

// PATCH — підтвердити або повернути консультацію в очікування
app.patch('/api/consultations/:id/confirm', async (req, res) => {
  try {
    await pool.query(
      "UPDATE consultations SET status = IF(status = 'pending', 'confirmed', 'pending') WHERE id = ?",
      [req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM consultations WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — скасувати та видалити запис
app.delete('/api/consultations/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM consultations WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер MedClinic (MySQL) запущено: http://localhost:${PORT}`);
});