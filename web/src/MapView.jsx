import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { eventColor } from './api';
import { segmentTrack } from './geo';

const MIN_POINT_ZOOM = 14;
const MAX_POINT_MARKERS = 800;

const carIcon = L.divIcon({
  className: 'car-marker',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function eventIcon(type, selected) {
  const color = eventColor(type);
  const size = selected ? 12 : 10;
  const border = selected ? '2px solid #fff' : '2px solid #fff';
  return L.divIcon({
    className: 'event-marker',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:${selected ? '0 0 8px rgba(255,255,255,.8)' : 'none'}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function pointsInBounds(points, bounds, max) {
  const inside = points.filter((p) => bounds.contains([p.lat, p.lng]));
  if (inside.length <= max) return inside;
  const step = Math.ceil(inside.length / max);
  return inside.filter((_, i) => i % step === 0);
}

export default function MapView({
  track,
  markers,
  current,
  followLive,
  selectedId,
  onSelectPoint,
  pointPopup,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const trackLayerRef = useRef(null);
  const pointsLayerRef = useRef(null);
  const markerRef = useRef(null);
  const markersRef = useRef(markers);
  const onSelectRef = useRef(onSelectPoint);
  const popupRef = useRef(pointPopup);
  const selectedRef = useRef(selectedId);

  markersRef.current = markers;
  onSelectRef.current = onSelectPoint;
  popupRef.current = pointPopup;
  selectedRef.current = selectedId;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true }).setView([45.46, 9.19], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    trackLayerRef.current = L.layerGroup().addTo(map);
    pointsLayerRef.current = L.layerGroup().addTo(map);
    markerRef.current = L.marker([45.46, 9.19], { icon: carIcon }).addTo(map);

    mapRef.current = map;

    const resize = () => map.invalidateSize();
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);
    window.addEventListener('orientationchange', resize);
    setTimeout(resize, 100);

    const refreshPoints = () => {
      const layer = pointsLayerRef.current;
      const pts = markersRef.current;
      if (!layer || !map) return;

      layer.clearLayers();
      if (!pts.length) return;

      const zoom = map.getZoom();
      const bounds = map.getBounds();
      const events = pts.filter((p) => p.type !== 'move');
      const moves = zoom >= MIN_POINT_ZOOM
        ? pointsInBounds(pts.filter((p) => p.type === 'move'), bounds, MAX_POINT_MARKERS)
        : [];

      for (const p of [...events, ...moves]) {
        const isMove = p.type === 'move';
        const selected = p.id === selectedRef.current;
        const m = isMove
          ? L.circleMarker([p.lat, p.lng], {
              radius: selected ? 7 : 5,
              color: '#fff',
              weight: selected ? 2 : 1,
              fillColor: eventColor(p.type),
              fillOpacity: 0.9,
            })
          : L.marker([p.lat, p.lng], { icon: eventIcon(p.type, selected) });

        m.bindPopup(popupRef.current(p));
        m.on('click', () => onSelectRef.current?.(p));
        m.addTo(layer);
      }
    };

    map.on('zoomend moveend', refreshPoints);
    map._refreshPoints = refreshPoints;

    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', resize);
      map.off('zoomend moveend', refreshPoints);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const trackLayer = trackLayerRef.current;
    if (!map || !trackLayer) return;

    trackLayer.clearLayers();
    const segments = segmentTrack(track);

    for (const seg of segments) {
      if (seg.length < 2) continue;
      const latlngs = seg.map((p) => [p.lat, p.lng]);
      L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.7 }).addTo(trackLayer);
      L.polyline(latlngs, { color: '#60a5fa', weight: 2, opacity: 0.4, dashArray: '4 8' }).addTo(trackLayer);
    }

    map._refreshPoints?.();
  }, [track]);

  useEffect(() => {
    mapRef.current?._refreshPoints?.();
  }, [markers, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !current) return;

    marker.setLatLng([current.lat, current.lng]);
    if (followLive) {
      map.setView([current.lat, current.lng], Math.max(map.getZoom(), 14), { animate: true });
    }
  }, [current, followLive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || track.length === 0) return;
    const bounds = L.latLngBounds(track.map((p) => [p.lat, p.lng]));
    if (bounds.isValid() && !followLive) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      setTimeout(() => map.invalidateSize(), 50);
    }
  }, [track, followLive]);

  return <div ref={containerRef} className="map" />;
}
