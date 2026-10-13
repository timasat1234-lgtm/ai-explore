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
  maxZoom: 19
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

// ===== 4. ПОИСК АДРЕСОВ =====
function formatPhotonLabel(p) {
  const parts = [];
  if (p.name) parts.push(p.name);
  else if (p.street) parts.push(p.street);
  if (p.housenumber) parts.push(p.housenumber);
  if (p.city && p.city !== p.name) parts.push(p.city);
  else if (p.district) parts.push(p.district);
  return parts.join(', ');
}

// Photon — быстрый поиск с подсказками
async function photonSearch(query, bias) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=ru&lat=${bias[0]}&lon=${bias[1]}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.features.map(f => ({
      label: formatPhotonLabel(f.properties) || f.properties.name || 'Без названия',
      latlng: L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0])
    }));
  } catch (e) {
    return [];
  }
}

// Nominatim — точный поиск (OpenStreetMap)
async function nominatimSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=kz&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AI-Explore-Student-Project/1.0' }
    });
    const data = await res.json();
    return data.map(item => ({
      label: item.display_name,
      latlng: L.latLng(parseFloat(item.lat), parseFloat(item.lon))
    }));
  } catch (e) {
    return [];
  }
}

// Умный поиск: 4 попытки — Photon → Photon без номера → Nominatim → Nominatim без номера
async function searchAddress(query) {
  if (!query || query.length < 3) return [];
  const cityBias = CITIES[currentCity].center;
  const cityName = { karaganda: 'Караганда', astana: 'Астана', almaty: 'Алматы' }[currentCity];

  // Попытка 1: Photon с полным запросом
  let results = await photonSearch(query, cityBias);
  if (results.length) return results;

  // Попытка 2: Photon без номера дома
  const streetOnly = query.replace(/\s+\d+[а-яa-z]?$/i, '').trim();
  if (streetOnly !== query) {
    results = await photonSearch(streetOnly, cityBias);
    if (results.length) return results;
  }

  // Попытка 3: Nominatim с городом
  results = await nominatimSearch(query + ', ' + cityName);
  if (results.length) return results;

  // Попытка 4: Nominatim только с улицей
  if (streetOnly !== query) {
    results = await nominatimSearch(streetOnly + ', ' + cityName);
    if (results.length) return results;
  }

  return [];
}

// Переход к адресу (для Enter)
async function goToAddress(query, setter) {
  if (!query || query.trim().length < 3) return;
  const results = await searchAddress(query.trim());
  if (!results.length) {
    alert('Адрес не найден: ' + query + '\nПопробуйте ввести только название улицы.');
    return;
  }
  const first = results[0];
  setter(first.latlng, first.label);
  map.flyTo(first.latlng, 17, { duration: 1.2 });
  const inputId = setter === setFrom ? 'fromInput' : 'toInput';
  document.getElementById(inputId).value = first.label;
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
        list.innerHTML = '<li style="color:#6b7a99;cursor:default">Ничего не найдено. Нажмите Enter для поиска только по улице.</li>';
        return;
      }
      results.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item.label;
        li.addEventListener('click', () => {
          input.value = item.label;
          list.classList.remove('visible');
          setter(item.latlng, item.label);
          map.flyTo(item.latlng, 17, { duration: 1.2 });
        });
        list.appendChild(li);
      });
    }, 350);
  });

  // Enter — искать адрес без выбора из списка
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      list.classList.remove('visible');
      goToAddress(input.value, setter);
    }
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
    setter(results[0].latlng, results[0].label);
    return results[0].latlng;
  }
  return null;
}

// ===== 5. УСТАНОВКА ТОЧЕК =====
function setFrom(latlng, label) {
  fromPoint = latlng;
  if (fromMarker) map.removeLayer(fromMarker);
  const popup = label ? 'Откуда: ' + label : 'Откуда';
  fromMarker = L.marker(latlng, { draggable: true }).addTo(map).bindPopup(popup).openPopup();
  fromMarker.on('dragend', (e) => {
    fromPoint = e.target.getLatLng();
    document.getElementById('fromInput').value =
      `${fromPoint.lat.toFixed(5)}, ${fromPoint.lng.toFixed(5)}`;
  });
}

function setTo(latlng, label) {
  toPoint = latlng;
  if (toMarker) map.removeLayer(toMarker);
  const popup = label ? 'Куда: ' + label : 'Куда';
  toMarker = L.marker(latlng, { draggable: true }).addTo(map).bindPopup(popup).openPopup();
  toMarker.on('dragend', (e) => {
    toPoint = e.target.getLatLng();
    document.getElementById('toInput').value =
      `${toPoint.lat.toFixed(5)}, ${toPoint.lng.toFixed(5)}`;
  });
}

// ===== 6. КЛИК ПО КАРТЕ =====
map.on('click', (e) => {
  if (activeField === 'from') {
    setFrom(e.latlng);
    document.getElementById('fromInput').value =
      `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  } else {
    setTo(e.latlng);
    document.getElementById('toInput').value =
      `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  }
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

// ===== 8. ИИ-ГИД ЧЕРЕЗ GROQ =====
const FALLBACK_TEXTS = [
  "🚗 Отличный маршрут! {km} км вы проедете примерно за {min} минут. Дорога проходит по основным улицам, где нет пробок и ремонтов.",
  "🚶 Приятная пешая прогулка на {km} км займёт около {min} минут. Маршрут проходит по тротуарам и аллеям, вдали от шумных дорог.",
  "Ваш маршрут: {km} км, время в пути — около {min} минут. Дорога удобная и безопасная. Хорошего пути!"
];

async function askGroq(prompt) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + window.CONFIG.GROQ_API_KEY
    },
    body: JSON.stringify({
      model: window.CONFIG.GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Ты — дружелюбный туристический гид приложения AI-Explore. Отвечай кратко, 3-4 предложения, без списков, дружелюбно, по-русски.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 300
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Groq: ' + err);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Нет ответа';
}

async function explainRoute(route) {
  const output = document.getElementById('geminiOutput');
  output.textContent = 'ИИ-гид готовит объяснение...';

  const km = (route.distance / 1000).toFixed(2);
  const min = Math.round(route.duration / 60);
  const modeText = transportMode === 'car' ? 'на автомобиле' : 'пешком';

  const prompt = `Маршрут ${modeText}: ${km} км, время в пути около ${min} минут. Кратко (3-4 предложения) объясни пользователю, почему этот маршрут удобен и безопасен, и дай одну полезную рекомендацию для прогулки.`;

  try {
    const text = await askGroq(prompt);
    output.textContent = text;
  } catch (e) {
    console.warn('Groq недоступен, использую заготовку:', e.message);
    const template = FALLBACK_TEXTS[Math.floor(Math.random() * FALLBACK_TEXTS.length)];
    output.textContent = template.replace(/{km}/g, km).replace(/{min}/g, min);
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
