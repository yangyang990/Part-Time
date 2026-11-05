// Leaflet + OpenStreetMap helpers.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DEFAULT_CENTER = [3.139, 101.6869];

const pinIcon = (cls) => L.divIcon({ className: `map-pin ${cls}`, html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

export function baseMap(el, { lat, lng, zoom = 16, interactive = true } = {}) {
  const map = L.map(el, {
    zoomControl: interactive, dragging: interactive, scrollWheelZoom: false,
    doubleClickZoom: interactive, touchZoom: interactive, attributionControl: true,
  }).setView(lat != null ? [lat, lng] : DEFAULT_CENTER, lat != null ? zoom : 11);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  // Maps inside freshly-rendered/modal containers need a size recalculation.
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

/** Read-only map showing the event site, its check-in radius, and optional extra points. */
export function siteMap(el, event, points = []) {
  const map = baseMap(el, { lat: event.lat, lng: event.lng });
  const circle = L.circle([event.lat, event.lng], { radius: event.radius_m, color: '#3e338f', weight: 2, fillOpacity: 0.12 }).addTo(map);
  L.marker([event.lat, event.lng], { icon: pinIcon('pin-site') }).addTo(map).bindTooltip(event.location_name);
  const layers = [circle];
  for (const p of points) {
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(p.cls || 'pin-me') }).addTo(map);
    if (p.label) m.bindTooltip(p.label);
    layers.push(m);
  }
  if (points.length) map.fitBounds(L.featureGroup(layers).getBounds().pad(0.3), { maxZoom: 17 });
  else map.fitBounds(circle.getBounds().pad(0.4));
  return map;
}

/** Map where the organiser drops a pin and sees the check-in radius. */
export function pickerMap(el, { lat, lng, radius, onChange }) {
  const map = baseMap(el, { lat, lng });
  map.scrollWheelZoom.enable();
  let marker = null, circle = null;
  const set = (la, ln, fly = false) => {
    if (!marker) {
      marker = L.marker([la, ln], { draggable: true, icon: pinIcon('pin-site') }).addTo(map);
      circle = L.circle([la, ln], { radius, color: '#3e338f', weight: 2, fillOpacity: 0.12 }).addTo(map);
      marker.on('drag', (e) => { circle.setLatLng(e.latlng); });
      marker.on('dragend', (e) => onChange(e.target.getLatLng().lat, e.target.getLatLng().lng));
    } else {
      marker.setLatLng([la, ln]);
      circle.setLatLng([la, ln]);
    }
    if (fly) map.setView([la, ln], Math.max(map.getZoom(), 16));
    onChange(la, ln);
  };
  if (lat != null) set(lat, lng);
  map.on('click', (e) => set(e.latlng.lat, e.latlng.lng));
  return {
    map,
    set,
    setRadius: (r) => { radius = r; circle?.setRadius(r); },
  };
}

/** Address search via OpenStreetMap Nominatim (free, light use only). */
export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Address search is unavailable right now. Click the map instead.');
  return (await res.json()).map((r) => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}
