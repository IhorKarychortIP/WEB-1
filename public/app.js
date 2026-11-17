document.getElementById('fetchBtn').addEventListener('click', async () => {
  const output = document.getElementById('output');
  output.textContent = 'Завантаження...';

  try {
    const response = await fetch('/api/info');
    const data = await response.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = 'Помилка запиту: ' + error.message;
  }
});