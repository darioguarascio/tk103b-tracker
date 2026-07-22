import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { eventColor } from './api';
import { segmentTrack, isPlausibleStep } from './geo';

const MIN_POINT_ZOOM = 14;
const MAX_POINT_MARKERS = 400;
const MARKER_SIZE = 24;
const MARKER_SIZE_LIVE = 32;

function normalizeHeading(angle) {
  const n = Number(angle);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

function vehicleMarkerHtml(angle, live) {
  const heading = normalizeHeading(angle);
  if (heading == null) {
    if (live) {
      return '<span class="live-ping"></span><span class="live-ping live-ping-delay"></span><span class="car-dot"></span>';
    }
    return '<div class="car-dot"></div>';
  }

  const arrow = `<svg class="vehicle-arrow" viewBox="0 0 24 24" aria-hidden="true" style="transform: rotate(${heading}deg)">
    <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" />
  </svg>`;

  if (live) {
    return `<span class="live-ping"></span><span class="live-ping live-ping-delay"></span><span class="vehicle-body">${arrow}</span>`;
  }
  return `<span class="vehicle-body">${arrow}</span>`;
}

function createVehicleIcon(current, live) {
  const heading = normalizeHeading(current?.angle);
  const size = live ? MARKER_SIZE_LIVE : MARKER_SIZE;
  return L.divIcon({
    className: `car-marker ${live ? 'car-marker-live' : ''} ${heading != null ? 'car-marker-arrow' : ''}`,
    html: vehicleMarkerHtml(current?.angle, live),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

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
  const inside = points.filter(
    (p) => p && p.lat != null && p.lng != null && bounds.contains([p.lat, p.lng])
  );
  if (inside.length <= max) return inside;
  const step = Math.ceil(inside.length / max);
  return inside.filter((_, i) => i % step === 0);
}

function addSegmentLines(layer, a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return;
  const latlngs = [[a.lat, a.lng], [b.lat, b.lng]];
  L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.7 }).addTo(layer);
  L.polyline(latlngs, { color: '#60a5fa', weight: 2, opacity: 0.4, dashArray: '4 8' }).addTo(layer);
}

function drawTrackSegments(layer, track) {
  layer.clearLayers();
  const segments = segmentTrack(track);
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const latlngs = seg.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.7 }).addTo(layer);
    L.polyline(latlngs, { color: '#60a5fa', weight: 2, opacity: 0.4, dashArray: '4 8' }).addTo(layer);
  }
}

function appendTrackSegment(layer, a, b) {
  if (!isPlausibleStep(a, b)) return;
  addSegmentLines(layer, a, b);
}

export default function MapView({
  track,
  boundsTrack,
  markers,
  current,
  isLive,
  playing,
  followEnabled,
  onUserMove,
  onRecenter,
  selectedId,
  selectedPoint,
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
  const suppressPanRef = useRef(false);
  const followRef = useRef(false);
  const onUserMoveRef = useRef(onUserMove);

  onUserMoveRef.current = onUserMove;
  const followLive = isLive;
  const followPosition = followEnabled;
  followRef.current = followPosition;

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
    markerRef.current = L.marker([45.46, 9.19], { icon: createVehicleIcon(null, false) }).addTo(map);
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
        if (!p || p.lat == null || p.lng == null) continue;
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
        if (p.id === selectedRef.current) {
          m.openPopup();
          if (!followRef.current) {
            map.panTo([p.lat, p.lng], { animate: true });
          }
        }
      }
    };

    map.on('zoomend moveend', refreshPoints);
    map._refreshPoints = refreshPoints;

    const onDragStart = () => {
      if (!suppressPanRef.current && followRef.current) onUserMoveRef.current?.();
    };
    const onZoomStart = (e) => {
      if (!suppressPanRef.current && followRef.current && e.originalEvent) {
        onUserMoveRef.current?.();
      }
    };

    map.on('dragstart', onDragStart);
    map.on('zoomstart', onZoomStart);

    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', resize);
      map.off('zoomend moveend', refreshPoints);
      map.off('dragstart', onDragStart);
      map.off('zoomstart', onZoomStart);
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
        liveDrawnLenRef.current = 0;
        liveDrawnHeadRef.current = track[0]?.id ?? null;
        prevFollowLiveRef.current = true;
        for (let i = 1; i < track.length; i++) {
          appendTrackSegment(trackLayer, track[i - 1], track[i]);
        }
        liveDrawnLenRef.current = track.length;
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
          appendTrackSegment(trackLayer, track[i - 1], track[i]);
        }
        liveDrawnLenRef.current = track.length;
        return;
      }

      while (liveDrawnLenRef.current < track.length) {
        const i = liveDrawnLenRef.current;
        if (i > 0) appendTrackSegment(trackLayer, track[i - 1], track[i]);
        liveDrawnLenRef.current += 1;
      }
      if (liveDrawnHeadRef.current == null) liveDrawnHeadRef.current = headId;
      return;
    }

    prevFollowLiveRef.current = false;
    liveDrawnLenRef.current = 0;
    liveDrawnHeadRef.current = null;
    drawTrackSegments(trackLayer, track);
  }, [track, followLive]);

  useEffect(() => {
    mapRef.current?._refreshPoints?.();
  }, [markers, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || followPosition || !selectedPoint || selectedPoint.lat == null || selectedPoint.lng == null) {
      return;
    }
    map.panTo([selectedPoint.lat, selectedPoint.lng], { animate: true });
  }, [selectedPoint?.id, followPosition, selectedPoint?.lat, selectedPoint?.lng]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    marker.setIcon(createVehicleIcon(current, isLive));
  }, [isLive, current?.angle, current?.lat, current?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !current || current.lat == null || current.lng == null) return;

    marker.setLatLng([current.lat, current.lng]);
    if (followPosition) {
      suppressPanRef.current = true;
      map.setView([current.lat, current.lng], Math.max(map.getZoom(), 14), { animate: true });
      map.once('moveend', () => { suppressPanRef.current = false; });
    }
  }, [current, followPosition]);

  const handleRecenter = () => {
    const map = mapRef.current;
    const marker = markerRef.current;
    onRecenter?.();
    if (!map || !marker) return;
    const latLng = marker.getLatLng();
    suppressPanRef.current = true;
    map.setView(latLng, Math.max(map.getZoom(), 14), { animate: true });
    map.once('moveend', () => { suppressPanRef.current = false; });
  };

  useEffect(() => {
    const map = mapRef.current;
    const fit = boundsTrack ?? track;
    if (!map || fit.length === 0 || followPosition) return;

    const key = `${fit.length}:${fit[0]?.id}:${fit[fit.length - 1]?.id}`;
    if (fittedKeyRef.current === key) return;
    fittedKeyRef.current = key;

    const latlngs = fit
      .filter((p) => p && p.lat != null && p.lng != null)
      .map((p) => [p.lat, p.lng]);
    if (latlngs.length === 0) return;
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      setTimeout(() => {
        map.invalidateSize();
        map._refreshPoints?.();
      }, 50);
    }
  }, [boundsTrack, track, followPosition]);

  const showRecenter = (isLive || playing) && !followEnabled;

  return (
    <div className="map-container">
      <div ref={containerRef} className="map" />
      {showRecenter && (
        <button
          type="button"
          className="map-recenter-btn"
          onClick={handleRecenter}
          aria-label="Center on tracker"
          title="Center on tracker"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      )}
    </div>
  );
}
