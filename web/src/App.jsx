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

export default function App() {
  const [trackers, setTrackers] = useState([]);
  const [trackerId, setTrackerId] = useState('');
  const [range, setRange] = useState(null);
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
      setRange(r);
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

      const moveQs = new URLSearchParams(qs);
      moveQs.set('types', 'move');
      const trackData = await fetchJson(`/api/track?${moveQs}`);

      const eventTypes = [...types].filter((t) => t !== 'move');
      let eventData = [];
      if (eventTypes.length) {
        const evQs = new URLSearchParams(qs);
        evQs.set('types', eventTypes.join(','));
        eventData = await fetchJson(`/api/events?${evQs}`);
      }

      setTrack(trackData);
      setEvents(eventData);
      setFrame(0);
      setPlaying(false);
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

  const current = useMemo(() => {
    if (mode === 'live' && livePos) return livePos;
    if (track.length === 0) return null;
    return track[Math.min(frame, track.length - 1)];
  }, [mode, livePos, track, frame]);

  const visibleEvents = useMemo(() => {
    if (mode === 'live') return events;
    if (!current) return events;
    const t = new Date(current.gps_time).getTime();
    return events.filter((e) => new Date(e.gps_time).getTime() <= t);
  }, [mode, events, current]);

  const toggleType = (type) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const applyDateWindow = (days, id) => {
    const { start, end } = windowRange(days, range?.max_time, range?.min_time);
    setFrom(toInputValue(start.toISOString()));
    setTo(toInputValue(end.toISOString()));
    setDateWindow(id);
  };

  const tracker = trackers.find((t) => String(t.id) === String(trackerId));

  return (
    <div className="app">
      <header className="toolbar">
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
        <button
          type="button"
          className={mode === 'replay' ? 'active' : 'secondary'}
          onClick={() => setMode('replay')}
        >
          Replay
        </button>
        <button
          type="button"
          className={mode === 'live' ? 'active' : 'secondary'}
          onClick={() => setMode('live')}
        >
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
      </header>

      <div className="main">
        <div className="map-wrap">
          <MapView
            track={mode === 'live' ? track : track.slice(0, frame + 1)}
            events={visibleEvents}
            current={current}
            followLive={mode === 'live'}
          />
        </div>

        <aside className="sidebar">
          <h3>Events ({visibleEvents.length})</h3>
          <div className="event-list">
            {visibleEvents.map((ev) => (
              <div
                key={ev.id}
                className="event-item"
                onClick={() => {
                  if (mode === 'replay') {
                    const idx = track.findIndex((p) => p.gps_time >= ev.gps_time);
                    if (idx >= 0) setFrame(idx);
                  }
                }}
              >
                <div className="type" style={{ color: eventColor(ev.type) }}>{ev.type}</div>
                <div className="time">{fmtShort(ev.gps_time)} · {ev.speed ?? 0} km/h</div>
              </div>
            ))}
            {visibleEvents.length === 0 && (
              <div className="event-item" style={{ color: 'var(--muted)' }}>No events in range</div>
            )}
          </div>
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
        {range && (
          <span className="stat">DB: <strong>{range.total?.toLocaleString()} pts</strong></span>
        )}
        {tracker?.last_seen && (
          <span className="stat">Last seen: <strong>{fmtShort(tracker.last_seen)}</strong></span>
        )}
      </footer>
    </div>
  );
}
