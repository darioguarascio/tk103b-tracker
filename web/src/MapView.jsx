import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { eventColor } from './api';
import { segmentTrack } from './geo';

const MIN_POINT_ZOOM = 14;
const MAX_POINT_MARKERS = 400;

const carIcon = L.divIcon({
  className: 'car-marker',
  html: '<div class="car-dot"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const carIconLive = L.divIcon({
  className: 'car-marker car-marker-live',
  html: '<span class="live-ping"></span><span class="live-ping live-ping-delay"></span><span class="car-dot"></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

function eventIcon(type, selected) {
  const color = eventColor(type);
  const size = selected ? 12 : 10;
  return L.divIcon({
    className: 'event-marker',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:${selected ? '0 0 8px rgba(255,255,255,.8)' : 'none'}"></div>`,
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

function addSegmentLines(layer, a, b) {
  const latlngs = [[a.lat, a.lng], [b.lat, b.lng]];
  L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.7 }).addTo(layer);
  L.polyline(latlngs, { color: '#60a5fa', weight: 2, opacity: 0.4, dashArray: '4 8' }).addTo(layer);
}

function drawFullTrack(layer, track) {
  layer.clearLayers();
  const segments = segmentTrack(track);
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const latlngs = seg.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.7 }).addTo(layer);
    L.polyline(latlngs, { color: '#60a5fa', weight: 2, opacity: 0.4, dashArray: '4 8' }).addTo(layer);
  }
}

export default function MapView({
  track,
  boundsTrack,
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
  const fittedKeyRef = useRef('');
  const markersRef = useRef(markers);
  const onSelectRef = useRef(onSelectPoint);
  const popupRef = useRef(pointPopup);
  const selectedRef = useRef(selectedId);
  const liveDrawnLenRef = useRef(0);
  const liveDrawnHeadRef = useRef(null);
  const prevFollowLiveRef = useRef(false);

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
      if (!layer || !map || !pts.length) {
        layer?.clearLayers();
        return;
      }

      layer.clearLayers();
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      const visible = pointsInBounds(pts, bounds, MAX_POINT_MARKERS);
      const toShow = zoom >= MIN_POINT_ZOOM
        ? visible
        : visible.filter((p) => p.type !== 'move');

      for (const p of toShow) {
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
    const trackLayer = trackLayerRef.current;
    if (!trackLayer) return;

    if (followLive) {
      if (!prevFollowLiveRef.current) {
        trackLayer.clearLayers();
        liveDrawnLenRef.current = track.length;
        liveDrawnHeadRef.current = track[0]?.id ?? null;
        prevFollowLiveRef.current = true;
        return;
      }

      const headId = track[0]?.id ?? null;
      const reset = track.length < liveDrawnLenRef.current
        || (liveDrawnHeadRef.current != null && headId !== liveDrawnHeadRef.current);

      if (reset) {
        trackLayer.clearLayers();
        liveDrawnLenRef.current = 0;
        liveDrawnHeadRef.current = headId;
        for (let i = 1; i < track.length; i++) {
          addSegmentLines(trackLayer, track[i - 1], track[i]);
        }
        liveDrawnLenRef.current = track.length;
        return;
      }

      while (liveDrawnLenRef.current < track.length) {
        const i = liveDrawnLenRef.current;
        if (i > 0) addSegmentLines(trackLayer, track[i - 1], track[i]);
        liveDrawnLenRef.current += 1;
      }
      if (liveDrawnHeadRef.current == null) liveDrawnHeadRef.current = headId;
      return;
    }

    prevFollowLiveRef.current = false;
    liveDrawnLenRef.current = 0;
    liveDrawnHeadRef.current = null;
    drawFullTrack(trackLayer, track);
  }, [track, followLive]);

  useEffect(() => {
    mapRef.current?._refreshPoints?.();
  }, [markers, selectedId]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    marker.setIcon(followLive ? carIconLive : carIcon);
  }, [followLive]);

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
    const fit = boundsTrack ?? track;
    if (!map || fit.length === 0 || followLive) return;

    const key = `${fit.length}:${fit[0]?.id}:${fit[fit.length - 1]?.id}`;
    if (fittedKeyRef.current === key) return;
    fittedKeyRef.current = key;

    const bounds = L.latLngBounds(fit.map((p) => [p.lat, p.lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      setTimeout(() => {
        map.invalidateSize();
        map._refreshPoints?.();
      }, 50);
    }
  }, [boundsTrack, track, followLive]);

  return <div ref={containerRef} className="map" />;
}
