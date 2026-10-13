// ===== 1. ДАННЫЕ О ГОРОДАХ =====
const CITIES = {
  karaganda: { center: [49.8047, 73.1094], zoom: 13 },
  astana:    { center: [51.1694, 71.4491], zoom: 13 },
  almaty:    { center: [43.2220, 76.8512], zoom: 13 }
};

const KZ_BOUNDS = L.latLngBounds([40.0, 46.0], [56.0, 88.0]);

// ===== 2. КАРТА =====
const map = L.map('map', {
  maxBounds: KZ_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom: 5,
  maxZoom: 18
}).setView(CITIES.karaganda.center, CITIES.karaganda.zoom);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap',
  maxZoom: 19
}).addTo(map);

// ===== 3. СОСТОЯНИЕ =====
let fromPoint = null;
let toPoint = null;
let activeField = 'from';
let fromMarker = null;
let toMarker = null;
let routeLine = null;
let transportMode = 'car';
let currentCity = 'karaganda';

// ===== 4. ПОИСК АДРЕСОВ ЧЕРЕЗ PHOTON =====
function formatPhotonLabel(p) {
  const parts = [];
  if (p.name) parts.push(p.name);
  else if (p.street) parts.push(p.street);

  if (p.housenumber) parts.push(p.housenumber);

  if (p.city && p.city !== p.name) parts.push(p.city);
  else if (p.district) parts.push(p.district);

  return parts.join(', ');
}

async function searchAddress(query) {
  if (!query || query.length < 3) return [];

  const cityBias = CITIES[currentCity].center;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=ru&lat=${cityBias[0]}&lon=${cityBias[1]}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.features.map(f => ({
      label: formatPhotonLabel(f.properties) || f.properties.name || 'Без названия',
      latlng: L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0])
    }));
  } catch (e) {
    console.warn('Ошибка поиска адреса', e);
    return [];
  }
}

function attachAutocomplete(inputId, suggestId, setter) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(suggestId);
  let debounceTimer = null;
  let requestId = 0;

  input.addEventListener('input', () => {
    activeField = inputId === 'fromInput' ? 'from' : 'to';

    clearTimeout(debounceTimer);
    const myId = ++requestId;

    debounceTimer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 3) {
        list.innerHTML = '';
        list.classList.remove('visible');
        return;
      }

      list.innerHTML = '<li style="color:#6b7a99;cursor:default">Поиск...</li>';
      list.classList.add('visible');

      const results = await searchAddress(q);

      if (myId !== requestId) return;

      list.innerHTML = '';
      if (!results.length) {
        list.innerHTML = '<li style="color:#6b7a99;cursor:default">Ничего не найдено</li>';
        return;
      }

      results.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item.label;
        li.addEventListener('click', () => {
          input.value = item.label;
          list.classList.remove('visible');
          setter(item.latlng);
        });
        list.appendChild(li);
      });
    }, 350);
  });

  document.addEventListener('click', (e) => {
    if (!list.contains(e.target) && e.target !== input) {
      list.classList.remove('visible');
    }
  });

  input.addEventListener('focus', () => {
    activeField = inputId === 'fromInput' ? 'from' : 'to';
    if (list.children.length && !list.querySelector('li[style*="cursor:default"]')) {
      list.classList.add('visible');
    }
  });
}

async function resolveAddressIfNeeded(inputId, currentPoint, setter) {
  if (currentPoint) return currentPoint;
  const text = document.getElementById(inputId).value.trim();
  if (!text) return null;

  const results = await searchAddress(text);
  if (results.length) {
    setter(results[0].latlng);
    return results[0].latlng;
  }
  return null;
}

// ===== 5. УСТАНОВКА ТОЧЕК =====
function setFrom(latlng) {
  fromPoint = latlng;
  if (fromMarker) map.removeLayer(fromMarker);
  fromMarker = L.marker(latlng, { draggable: true }).addTo(map).bindPopup('Откуда').openPopup();
  fromMarker.on('dragend', (e) => { fromPoint = e.target.getLatLng(); });
  document.getElementById('fromInput').value =
    `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function setTo(latlng) {
  toPoint = latlng;
  if (toMarker) map.removeLayer(toMarker);
  toMarker = L.marker(latlng, { draggable: true }).addTo(map).bindPopup('Куда').openPopup();
  toMarker.on('dragend', (e) => { toPoint = e.target.getLatLng(); });
  document.getElementById('toInput').value =
    `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

// ===== 6. КЛИК ПО КАРТЕ =====
map.on('click', (e) => {
  if (activeField === 'from') setFrom(e.latlng);
  else setTo(e.latlng);
});

document.getElementById('fromInput').addEventListener('focus', () => activeField = 'from');
document.getElementById('toInput').addEventListener('focus', () => activeField = 'to');

// ===== 7. ПОСТРОЕНИЕ МАРШРУТА =====
async function buildRoute() {
  if (!fromPoint) {
    document.getElementById('routeInfo').textContent = 'Ищу адрес "Откуда"...';
    fromPoint = await resolveAddressIfNeeded('fromInput', fromPoint, setFrom);
  }
  if (!toPoint) {
    document.getElementById('routeInfo').textContent = 'Ищу адрес "Куда"...';
    toPoint = await resolveAddressIfNeeded('toInput', toPoint, setTo);
  }

  if (!fromPoint || !toPoint) {
    document.getElementById('routeInfo').textContent = '';
    alert('Не удалось определить адрес. Кликните по карте или выберите адрес из подсказок.');
    return;
  }

  const baseUrl = transportMode === 'car'
    ? window.CONFIG.OSRM_CAR
    : window.CONFIG.OSRM_FOOT;

  const url = `${baseUrl}/${fromPoint.lng},${fromPoint.lat};${toPoint.lng},${toPoint.lat}?overview=full&geometries=geojson`;

  document.getElementById('routeInfo').textContent = 'Строим маршрут...';

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok') throw new Error('Маршрут не найден');

    const route = data.routes[0];
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(coords, { color: '#3ea6ff', weight: 5 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

    const km = (route.distance / 1000).toFixed(2);
    const min = Math.round(route.duration / 60);
    const icon = transportMode === 'car' ? '🚗' : '🚶';

    document.getElementById('routeInfo').textContent = `${icon} ${km} км · ⏱️ ${min} мин`;

    await explainRoute(route);
  } catch (e) {
    document.getElementById('routeInfo').textContent = 'Ошибка: ' + e.message;
  }
}

// ===== 8. GEMINI — КЛЮЧ AQ. ПЕРЕДАЁТСЯ ЧЕРЕЗ BEARER =====
async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${window.CONFIG.GEMINI_MODEL}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${window.CONFIG.GEMINI_API_KEY}`
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Gemini: ' + err);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет ответа';
}

async function explainRoute(route) {
  const output = document.getElementById('geminiOutput');
  output.textContent = 'ИИ-гид готовит объяснение...';

  const km = (route.distance / 1000).toFixed(2);
  const min = Math.round(route.duration / 60);
  const modeText = transportMode === 'car' ? 'на автомобиле' : 'пешком';

  const prompt = `Ты — дружелюбный туристический гид приложения AI-Explore.
Маршрут ${modeText}: ${km} км, время в пути около ${min} минут.
Кратко (3–4 предложения) объясни пользователю, почему этот маршрут удобен и безопасен,
и дай одну полезную рекомендацию для прогулки. Пиши по-русски, дружелюбно, без списков.`;

  try {
    const text = await askGemini(prompt);
    output.textContent = text;
  } catch (e) {
    output.textContent = 'Не удалось получить ответ от ИИ: ' + e.message;
  }
}

// ===== 9. ПЕРЕКЛЮЧЕНИЕ ГОРОДОВ =====
document.querySelectorAll('.city-switch button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.city-switch button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCity = btn.dataset.city;
    map.setView(CITIES[currentCity].center, CITIES[currentCity].zoom);
  });
});

// ===== 10. ПЕРЕКЛЮЧАТЕЛЬ ТРАНСПОРТА =====
function setTransportMode(mode) {
  transportMode = mode;
  document.getElementById('modeCar').classList.toggle('active', mode === 'car');
  document.getElementById('modeFoot').classList.toggle('active', mode === 'foot');

  if (fromPoint && toPoint && routeLine) {
    buildRoute();
  }
}

document.getElementById('modeCar').addEventListener('click', () => setTransportMode('car'));
document.getElementById('modeFoot').addEventListener('click', () => setTransportMode('foot'));

// ===== 11. КНОПКА «ПОСТРОИТЬ МАРШРУТ» =====
document.getElementById('routeBtn').addEventListener('click', buildRoute);

// ===== 12. АВТОДОПОЛНЕНИЕ =====
attachAutocomplete('fromInput', 'fromSuggest', setFrom);
attachAutocomplete('toInput', 'toSuggest', setTo);
