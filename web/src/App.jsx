import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView';
import { ALL_TYPES, eventColor, fetchJson, fmtShort, fmtTime } from './api';
import { DATE_WINDOWS, isPlausibleStep, windowRange } from './geo';

function toInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputValue(val) {
  if (!val) return null;
  return new Date(val).toISOString();
}

function pointPopup(p) {
  return `<strong>${p.type}</strong><br>${new Date(p.gps_time).toLocaleString()}<br>${p.speed ?? 0} km/h · ${Math.round(p.angle ?? 0)}°`;
}

const MAX_SIDEBAR_ITEMS = 500;

function ToolbarControls({
  trackers, trackerId, setTrackerId, from, setFrom, to, setTo, setDateWindow,
  mode, types, toggleType, dateWindow, applyDateWindow, loadData, loading,
  setMode, playing, setPlaying, track, speed, setSpeed,
}) {
  return (
    <>
      <label>
        Tracker
        <select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
          {trackers.map((t) => (
            <option key={t.id} value={t.id}>{t.label || t.imei}</option>
          ))}
        </select>
      </label>

      <label>
        From
        <input type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); setDateWindow(''); }} disabled={mode === 'live'} />
      </label>
      <label>
        To
        <input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setDateWindow(''); }} disabled={mode === 'live'} />
      </label>

      <div className="date-windows">
        {DATE_WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`window-chip ${dateWindow === w.id ? 'on' : ''}`}
            onClick={() => applyDateWindow(w.days, w.id)}
            disabled={mode === 'live'}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div className="type-filters">
        {ALL_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={`type-chip ${types.has(type) ? 'on' : ''}`}
            style={{ borderColor: types.has(type) ? eventColor(type) : undefined }}
            onClick={() => toggleType(type)}
          >
            {type}
          </button>
        ))}
      </div>

      <button type="button" className="secondary" onClick={loadData} disabled={loading || mode === 'live'}>
        {loading ? 'Loading…' : 'Reload'}
      </button>
      <button type="button" className={mode === 'replay' ? 'active' : 'secondary'} onClick={() => setMode('replay')}>
        Replay
      </button>
      <button type="button" className={mode === 'live' ? 'active' : 'secondary'} onClick={() => setMode('live')}>
        Live ●
      </button>

      {mode === 'replay' && (
        <>
          <button type="button" onClick={() => setPlaying((p) => !p)} disabled={track.length === 0}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <label>
            Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
              <option value={8}>8x</option>
              <option value={16}>16x</option>
            </select>
          </label>
        </>
      )}
    </>
  );
}

function EventsList({
  sidebarItems, sidebarVisible, types, track, selectedId, selectPoint, onItemClick,
}) {
  return (
    <>
      <h3>Events ({sidebarItems.length})</h3>
      {types.has('move') && track.length > 0 && (
        <div className="sidebar-summary">{track.length.toLocaleString()} move points on map</div>
      )}
      <div className="event-list">
        {sidebarVisible.map((ev) => (
          <div
            key={ev.id}
            className={`event-item ${selectedId === ev.id ? 'selected' : ''}`}
            onClick={() => { selectPoint(ev); onItemClick?.(); }}
          >
            <div className="type" style={{ color: eventColor(ev.type) }}>{ev.type}</div>
            <div className="time">{fmtShort(ev.gps_time)} · {ev.speed ?? 0} km/h</div>
          </div>
        ))}
        {sidebarItems.length === 0 && !types.has('move') && (
          <div className="event-item" style={{ color: 'var(--muted)' }}>No events in range</div>
        )}
        {sidebarItems.length === 0 && types.has('move') && (
          <div className="event-item" style={{ color: 'var(--muted)' }}>No events — track on map</div>
        )}
        {sidebarItems.length > MAX_SIDEBAR_ITEMS && (
          <div className="event-item" style={{ color: 'var(--muted)' }}>
            + {(sidebarItems.length - MAX_SIDEBAR_ITEMS).toLocaleString()} more
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const [trackers, setTrackers] = useState([]);
  const [trackerId, setTrackerId] = useState('');
  const [dbRange, setDbRange] = useState(null);
  const [windowStats, setWindowStats] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [types, setTypes] = useState(new Set(['move']));
  const [track, setTrack] = useState([]);
  const [events, setEvents] = useState([]);
  const [mode, setMode] = useState('replay');
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [speed, setSpeed] = useState(4);
  const [loading, setLoading] = useState(false);
  const [livePos, setLivePos] = useState(null);
  const [dateWindow, setDateWindow] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const liveRef = useRef(null);
  const liveLastRef = useRef(null);

  useEffect(() => {
    fetchJson('/api/trackers').then((rows) => {
      setTrackers(rows);
      if (rows.length && !trackerId) setTrackerId(String(rows[0].id));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!trackerId) return;
    fetchJson(`/api/range?tracker_id=${trackerId}`).then((r) => {
      setDbRange(r);
      if (r?.min_time) setFrom(toInputValue(r.min_time));
      if (r?.max_time) setTo(toInputValue(r.max_time));
    }).catch(console.error);
  }, [trackerId]);

  const loadData = useCallback(async () => {
    if (!trackerId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ tracker_id: trackerId });
      if (from) qs.set('from', fromInputValue(from));
      if (to) qs.set('to', fromInputValue(to));

      const statsQs = new URLSearchParams(qs);
      const fetches = [fetchJson(`/api/range?${statsQs}`).then(setWindowStats)];

      if (types.has('move')) {
        const moveQs = new URLSearchParams(qs);
        moveQs.set('types', 'move');
        fetches.push(fetchJson(`/api/track?${moveQs}`).then(setTrack));
      } else {
        setTrack([]);
      }

      const eventTypes = [...types].filter((t) => t !== 'move');
      if (eventTypes.length) {
        const evQs = new URLSearchParams(qs);
        evQs.set('types', eventTypes.join(','));
        fetches.push(fetchJson(`/api/events?${evQs}`).then(setEvents));
      } else {
        setEvents([]);
      }

      await Promise.all(fetches);
      setFrame(0);
      setPlaying(false);
      setSelectedId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [trackerId, from, to, types]);

  useEffect(() => {
    if (mode === 'replay') loadData();
  }, [loadData, mode]);

  useEffect(() => {
    if (mode !== 'live' || !trackerId) return;

    const es = new EventSource(`/api/live?tracker_id=${trackerId}`);
    liveRef.current = es;

    es.onmessage = (e) => {
      const row = JSON.parse(e.data);
      if (row.type === 'move') {
        const last = liveLastRef.current;
        if (last && !isPlausibleStep(last, row)) return;
        liveLastRef.current = row;
        setLivePos(row);
        setTrack((prev) => {
          const next = [...prev, row];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } else {
        setEvents((prev) => [row, ...prev].slice(0, 200));
      }
    };

    liveLastRef.current = null;
    setTrack([]);
    setEvents([]);

    fetchJson(`/api/positions/latest?tracker_id=${trackerId}`).then((rows) => {
      if (rows[0]) {
        liveLastRef.current = rows[0];
        setLivePos(rows[0]);
      }
    });

    return () => es.close();
  }, [mode, trackerId]);

  useEffect(() => {
    if (!playing || track.length === 0) return;
    const ms = Math.max(50, 500 / speed);
    const id = setInterval(() => {
      setFrame((f) => (f >= track.length - 1 ? (setPlaying(false), f) : f + 1));
    }, ms);
    return () => clearInterval(id);
  }, [playing, track.length, speed]);

  const replayTrack = useMemo(
    () => (mode === 'live' ? track : track.slice(0, frame + 1)),
    [mode, track, frame]
  );

  const current = useMemo(() => {
    if (mode === 'live' && livePos) return livePos;
    if (track.length === 0) return null;
    return track[Math.min(frame, track.length - 1)];
  }, [mode, livePos, track, frame]);

  const sidebarItems = useMemo(() => {
    const items = events.filter((e) => types.has(e.type));
    items.sort((a, b) => new Date(b.gps_time) - new Date(a.gps_time));
    return items;
  }, [events, types]);

  const sidebarVisible = useMemo(
    () => sidebarItems.slice(0, MAX_SIDEBAR_ITEMS),
    [sidebarItems]
  );

  const mapMarkers = useMemo(() => {
    const items = [];
    if (mode !== 'live' && current) {
      const t = new Date(current.gps_time).getTime();
      if (types.has('move')) {
        const start = Math.max(0, frame - 200);
        for (let i = start; i <= frame && i < track.length; i++) items.push(track[i]);
      }
      for (const e of events) {
        if (types.has(e.type) && new Date(e.gps_time).getTime() <= t) items.push(e);
      }
    } else {
      if (types.has('move')) {
        const tail = track.length > 300 ? track.slice(-300) : track;
        items.push(...tail);
      }
      for (const e of events) {
        if (types.has(e.type)) items.push(e);
      }
    }
    return items;
  }, [track, events, types, mode, current, frame]);

  const selectPoint = useCallback((point) => {
    setSelectedId(point.id);
    if (mode === 'replay' && point.type === 'move') {
      const idx = track.findIndex((p) => p.id === point.id);
      if (idx >= 0) setFrame(idx);
    } else if (mode === 'replay') {
      const idx = track.findIndex((p) => p.gps_time >= point.gps_time);
      if (idx >= 0) setFrame(idx);
    }
  }, [mode, track]);

  const toggleType = (type) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const applyDateWindow = (days, id) => {
    const { start, end } = windowRange(days, dbRange?.max_time, dbRange?.min_time);
    setFrom(toInputValue(start.toISOString()));
    setTo(toInputValue(end.toISOString()));
    setDateWindow(id);
  };

  const tracker = trackers.find((t) => String(t.id) === String(trackerId));
  const loadedMove = types.has('move') ? track.length : 0;
  const loadedEvents = events.filter((e) => types.has(e.type)).length;
  const loadedTotal = loadedMove + loadedEvents;
  const windowTotal = windowStats?.total ?? loadedTotal;

  const toolbarProps = {
    trackers, trackerId, setTrackerId, from, setFrom, to, setTo, setDateWindow,
    mode, types, toggleType, dateWindow, applyDateWindow, loadData, loading,
    setMode, playing, setPlaying, track, speed, setSpeed,
  };

  const eventsProps = {
    sidebarItems, sidebarVisible, types, track, selectedId, selectPoint,
    onItemClick: () => setEventsOpen(false),
  };

  useEffect(() => {
    document.body.style.overflow = menuOpen || eventsOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen, eventsOpen]);

  return (
    <div className="app">
      <header className="mobile-header">
        <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <span className="hamburger" />
        </button>
        <span className="mobile-title">TK103B Tracker</span>
        <button
          type="button"
          className={`icon-btn events-toggle ${eventsOpen ? 'on' : ''}`}
          onClick={() => setEventsOpen((o) => !o)}
        >
          Events {sidebarItems.length > 0 && `(${sidebarItems.length})`}
        </button>
      </header>

      <header className="toolbar">
        <ToolbarControls {...toolbarProps} />
      </header>

      {menuOpen && (
        <div className="drawer-overlay" onClick={() => setMenuOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>Controls</h2>
              <button type="button" className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <div className="drawer-body toolbar">
              <ToolbarControls {...toolbarProps} />
            </div>
          </aside>
        </div>
      )}

      {eventsOpen && (
        <div className="events-overlay" onClick={() => setEventsOpen(false)}>
          <aside className="events-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>Events</h2>
              <button type="button" className="icon-btn" onClick={() => setEventsOpen(false)} aria-label="Close events">✕</button>
            </div>
            <EventsList {...eventsProps} />
          </aside>
        </div>
      )}

      <div className="main">
        <div className="map-wrap">
          <MapView
            track={replayTrack}
            boundsTrack={track}
            markers={mapMarkers}
            current={current}
            followLive={mode === 'live'}
            selectedId={selectedId}
            onSelectPoint={selectPoint}
            pointPopup={pointPopup}
          />
        </div>

        <aside className="sidebar desktop-only">
          <EventsList {...eventsProps} />
        </aside>
      </div>

      <footer className="status-bar">
        {current ? (
          <>
            <span className="stat">Time: <strong>{fmtTime(current.gps_time)}</strong></span>
            <span className="stat">Speed: <strong>{current.speed ?? 0} km/h</strong></span>
            <span className="stat">Heading: <strong>{Math.round(current.angle ?? 0)}°</strong></span>
            <span className="stat">Type: <strong>{current.type}</strong></span>
          </>
        ) : (
          <span className="stat">No position data</span>
        )}
        {mode === 'replay' && track.length > 0 && (
          <>
            <input
              className="timeline"
              type="range"
              min={0}
              max={track.length - 1}
              value={frame}
              onChange={(e) => { setFrame(Number(e.target.value)); setPlaying(false); }}
            />
            <span className="stat">{frame + 1} / {track.length}</span>
          </>
        )}
        {windowStats && (
          <span className="stat">
            Window: <strong>{windowTotal.toLocaleString()} pts</strong>
            {loadedTotal < windowTotal && ` (${loadedTotal.toLocaleString()} loaded)`}
          </span>
        )}
        {tracker?.last_seen && (
          <span className="stat">Last seen: <strong>{fmtShort(tracker.last_seen)}</strong></span>
        )}
      </footer>
    </div>
  );
}
