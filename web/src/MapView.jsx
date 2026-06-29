import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { eventColor } from './api';

const carIcon = L.divIcon({
  className: 'car-marker',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function eventIcon(type) {
  const color = eventColor(type);
  return L.divIcon({
    className: 'event-marker',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

export default function MapView({ track, events, current, followLive }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const trackLayerRef = useRef(null);
  const eventsLayerRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true }).setView([45.46, 9.19], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    trackLayerRef.current = L.layerGroup().addTo(map);
    eventsLayerRef.current = L.layerGroup().addTo(map);
    markerRef.current = L.marker([45.46, 9.19], { icon: carIcon }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const trackLayer = trackLayerRef.current;
    if (!map || !trackLayer) return;

    trackLayer.clearLayers();
    if (track.length < 2) return;

    const latlngs = track.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.7 }).addTo(trackLayer);
    L.polyline(latlngs, { color: '#60a5fa', weight: 2, opacity: 0.4, dashArray: '4 8' }).addTo(trackLayer);
  }, [track]);

  useEffect(() => {
    const layer = eventsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const ev of events) {
      const m = L.marker([ev.lat, ev.lng], { icon: eventIcon(ev.type) });
      m.bindPopup(`<strong>${ev.type}</strong><br>${new Date(ev.gps_time).toLocaleString()}<br>${ev.speed ?? 0} km/h`);
      m.addTo(layer);
    }
  }, [events]);

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
    }
  }, [track, followLive]);

  return <div ref={containerRef} className="map" />;
}
