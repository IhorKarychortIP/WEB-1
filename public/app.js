const { useState, useEffect } = React;

const SPECIALTIES = ['Усі напрямки', 'Терапевт', 'Кардіолог', 'Невролог', 'Офтальмолог', 'Дерматолог'];

// Компонент картки окремої консультації
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
        <p className="date-info">Час прийому: <strong>{item.appointment_date.replace('T', ' ')}</strong></p>
      </div>

      <div className="card-actions">
        <button
          className={isConfirmed ? 'btn-secondary' : 'btn-confirm'}
          onClick={() => onToggleStatus(item.id)}
        >
          {isConfirmed ? 'Повернути в очікування' : 'Підтвердити запис'}
        </button>
        <button className="btn-delete" onClick={() => onDelete(item.id)} title="Скасувати запис">
          Скасувати
        </button>
      </div>
    </div>
  );
}

// Головний компонент
function App() {
  const [consultations, setConsultations] = useState([]);
  const [patientName, setPatientName] = useState('');
  const [specialty, setSpecialty] = useState('Терапевт');
  const [date, setDate] = useState('2026-11-22T10:00');
  const [filterSpecialty, setFilterSpecialty] = useState('Усі напрямки');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/consultations')
      .then((res) => res.json())
      .then((data) => {
        setConsultations(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Помилка отримання даних:', err);
        setLoading(false);
      });
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!patientName.trim() || !date) return;

    const res = await fetch('/api/consultations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_name: patientName,
        doctor_specialty: specialty,
        appointment_date: date
      })
    });

    if (res.ok) {
      const created = await res.json();
      setConsultations([created, ...consultations]);
      setPatientName('');
    }
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
              <span>Електронна реєстратура консультацій</span>
            </div>
          </div>
          <div className="stats-pill">
            Усього записів: <strong>{consultations.length}</strong>
          </div>
        </div>
      </header>

      <main className="main-grid">
        {/* Ліва колонка: форма запису */}
        <section className="panel form-panel">
          <h2>Новий запис на консультацію</h2>
          <p className="panel-subtitle">Оберіть профільного спеціаліста та зручний час візиту</p>

          <form onSubmit={handleCreate} className="booking-form">
            <label>
              ПІБ пацієнта
              <input
                type="text"
                placeholder="Наприклад: Шевченко Тарас"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
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
              Дата та час консультації
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>

            <button type="submit" className="btn-primary">Записати на прийом</button>
          </form>
        </section>

        {/* Права колонка: динамічний список записів */}
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
            <div className="empty-state">Завантаження розкладу з бази даних...</div>
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