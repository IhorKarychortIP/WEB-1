const { useState, useEffect } = React;

const SPECIALTIES = ['Усі напрямки', 'Терапевт', 'Кардіолог', 'Невролог', 'Офтальмолог', 'Дерматолог'];
const STORAGE_KEY = 'medclinic_patient_draft';
const SESSION_COUNT_KEY = 'medclinic_session_created_count';
const SESSION_FILTER_KEY = 'medclinic_session_filter';

function ConsultationCard({ item, onToggleStatus, onDelete }) {
  const isConfirmed = item.status === 'confirmed';

  return (
    <div className={`consultation-card ${isConfirmed ? 'confirmed' : ''}`}>
      <div className="card-main">
        <div className="card-top">
          <span className="specialty-tag">{item.doctor_specialty}</span>
          <span className={`status-badge ${isConfirmed ? 'status-ok' : 'status-wait'}`}>
            {isConfirmed ? 'Підтверджено' : 'Очікує підтвердження'}
          </span>
        </div>
        <h3 className="patient-name">{item.patient_name}</h3>
        <p className="date-info">
          Тел: <strong>{item.patient_phone}</strong> &bull; Прийом: <strong>{item.appointment_date.replace('T', ' ')}</strong>
        </p>
        {item.symptoms && (
          <p className="symptoms-box">Скарги: {item.symptoms}</p>
        )}
      </div>

      <div className="card-actions">
        <button
          className={isConfirmed ? 'btn-secondary' : 'btn-confirm'}
          onClick={() => onToggleStatus(item.id)}
        >
          {isConfirmed ? 'Повернути в очікування' : 'Підтвердити запис'}
        </button>
        <button className="btn-delete" onClick={() => onDelete(item.id)}>
          Скасувати
        </button>
      </div>
    </div>
  );
}

function App() {
  // Зчитування збережених даних із localStorage при завантаженні
  const savedDraft = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

  const [consultations, setConsultations] = useState([]);
  const [patientName, setPatientName] = useState(savedDraft.patientName || '');
  const [patientPhone, setPatientPhone] = useState(savedDraft.patientPhone || '');
  const [specialty, setSpecialty] = useState(savedDraft.specialty || 'Терапевт');
  const [date, setDate] = useState(savedDraft.date || '2026-11-25T10:00');
  const [symptoms, setSymptoms] = useState(savedDraft.symptoms || '');

  // Дані поточної вкладки у sessionStorage
  const [filterSpecialty, setFilterSpecialty] = useState(
    sessionStorage.getItem(SESSION_FILTER_KEY) || 'Усі напрямки'
  );
  const [sessionCount, setSessionCount] = useState(
    Number(sessionStorage.getItem(SESSION_COUNT_KEY) || 0)
  );

  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  // Автоматичне збереження чернетки форми в localStorage при зміні полів
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ patientName, patientPhone, specialty, date, symptoms })
    );
  }, [patientName, patientPhone, specialty, date, symptoms]);

  // Збереження активного фільтра в sessionStorage
  useEffect(() => {
    sessionStorage.setItem(SESSION_FILTER_KEY, filterSpecialty);
  }, [filterSpecialty]);

  useEffect(() => {
    fetch('/api/consultations')
      .then((res) => res.json())
      .then((data) => {
        setConsultations(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleClearStorage = () => {
    localStorage.removeItem(STORAGE_KEY);
    setPatientName('');
    setPatientPhone('');
    setSymptoms('');
    setFormError('');
    setFormSuccess('Локальне сховище очищено.');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    // Клієнтська перевірка перед відправкою
    if (patientName.trim().length < 3) {
      setFormError('Введіть коректне ПІБ (мінімум 3 символи).');
      return;
    }

    const res = await fetch('/api/consultations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_name: patientName,
        patient_phone: patientPhone,
        doctor_specialty: specialty,
        appointment_date: date,
        symptoms
      })
    });

    const data = await res.json();

    if (!res.ok) {
      setFormError(data.error || 'Помилка валідації даних');
      return;
    }

    setConsultations([data, ...consultations]);
    setSymptoms(''); // Очищаємо тільки симптоми, ПІБ і телефон залишаються в localStorage для зручності
    setFormSuccess('Запис успішно збережено та перевірено сервером.');

    // Оновлюємо лічильник поточної сесії в sessionStorage
    const nextCount = sessionCount + 1;
    setSessionCount(nextCount);
    sessionStorage.setItem(SESSION_COUNT_KEY, String(nextCount));
  };

  const handleToggleStatus = async (id) => {
    const res = await fetch(`/api/consultations/${id}/confirm`, { method: 'PATCH' });
    if (res.ok) {
      const updated = await res.json();
      setConsultations(consultations.map((c) => (c.id === id ? updated : c)));
    }
  };

  const handleDelete = async (id) => {
    const res = await fetch(`/api/consultations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setConsultations(consultations.filter((c) => c.id !== id));
    }
  };

  const filteredList = consultations.filter((c) =>
    filterSpecialty === 'Усі напрямки' ? true : c.doctor_specialty === filterSpecialty
  );

  return (
    <div className="page-wrapper">
      <header className="navbar">
        <div className="nav-content">
          <div className="logo">
            <span className="logo-cross">+</span>
            <div>
              <h1>MedClinic</h1>
              <span>Захищена система запису на консультації</span>
            </div>
          </div>
          <div className="nav-badges">
            <div className="stats-pill" title="Зберігається у sessionStorage до закриття вкладки">
              Заявок за сесію: <strong>{sessionCount}</strong>
            </div>
            <div className="stats-pill">
              У базі: <strong>{consultations.length}</strong>
            </div>
          </div>
        </div>
      </header>

      <main className="main-grid">
        <section className="panel form-panel">
          <div className="form-header-row">
            <h2>Запис на прийом</h2>
            <button type="button" className="btn-link" onClick={handleClearStorage} title="Очистити localStorage">
              Очистити кеш форми
            </button>
          </div>
          <p className="panel-subtitle">Дані форми автоматично зберігаються у localStorage</p>

          {formError && <div className="alert alert-error">{formError}</div>}
          {formSuccess && <div className="alert alert-success">{formSuccess}</div>}

          <form onSubmit={handleCreate} className="booking-form">
            <label>
              ПІБ пацієнта *
              <input
                type="text"
                placeholder="Шевченко Тарас Григорович"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                required
              />
            </label>

            <label>
              Контактний телефон *
              <input
                type="tel"
                placeholder="+380671234567"
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                required
              />
            </label>

            <label>
              Спеціалізація лікаря
              <select value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
                {SPECIALTIES.filter((s) => s !== 'Усі напрямки').map((spec) => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
            </label>

            <label>
              Дата та час консультації *
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>

            <label>
              Причина звернення / скарги
              <textarea
                rows="3"
                placeholder="Коротко опишіть симптоми (до 500 символів)..."
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
              />
            </label>

            <button type="submit" className="btn-primary">Надіслати заявку</button>
          </form>
        </section>

        <section className="panel list-panel">
          <div className="list-header">
            <h2>Журнал консультацій</h2>
            <select
              className="filter-select"
              value={filterSpecialty}
              onChange={(e) => setFilterSpecialty(e.target.value)}
            >
              {SPECIALTIES.map((spec) => (
                <option key={spec} value={spec}>{spec}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="empty-state">Завантаження даних...</div>
          ) : filteredList.length === 0 ? (
            <div className="empty-state">Записів за обраним напрямком не знайдено.</div>
          ) : (
            <div className="cards-container">
              {filteredList.map((item) => (
                <ConsultationCard
                  key={item.id}
                  item={item}
                  onToggleStatus={handleToggleStatus}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);