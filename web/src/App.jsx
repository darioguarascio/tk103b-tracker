import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView';
import { ALL_TYPES, eventColor, fetchJson, fmtRelativeAgo, fmtShort, fmtTime, isLiveToastType, liveUpdateFreshness } from './api';
import { DATE_WINDOWS, isPlausibleStep, isStationaryMove, windowRange } from './geo';

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
const MODE_STORAGE_KEY = 'tk103b-mode';
const LIVE_FEED_STORAGE_KEY = 'tk103b-live-feed';
const LIVE_EVENTS_HOURS = 24;
const MAX_LIVE_EVENTS = 200;
const MAX_TOASTS = 5;

function loadStoredMode() {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'live' || stored === 'replay') return stored;
  } catch {
    // ignore unavailable storage
  }
  return 'replay';
}

function loadShowLiveFeed() {
  try {
    return localStorage.getItem(LIVE_FEED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function ToolbarControls({
  trackers, trackerId, setTrackerId, from, setFrom, to, setTo, setDateWindow,
  mode, types, toggleType, dateWindow, applyDateWindow, loadData, loading,
  setMode,
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
        Mode
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="replay">Replay</option>
          <option value="live">Live</option>
        </select>
      </label>

      <label>
        Range
        <select
          value={dateWindow}
          onChange={(e) => {
            const w = DATE_WINDOWS.find((x) => x.id === e.target.value);
            if (w) applyDateWindow(w.days, w.id);
            else setDateWindow('');
          }}
          disabled={mode === 'live'}
        >
          <option value="">Custom</option>
          {DATE_WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
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
    </>
  );
}

function LiveEventStream({
  items, liveTick, highlightIds, selectedId, selectPoint, onHideFeed,
}) {
  const listRef = useRef(null);
  const prevLenRef = useRef(items.length);

  useEffect(() => {
    if (items.length > prevLenRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
    prevLenRef.current = items.length;
  }, [items.length]);

  return (
    <>
      <div className="live-feed-header">
        <h3>
          Live feed <span className="live-dot" aria-hidden="true" />
        </h3>
        <span className="live-feed-count">{items.length}</span>
        <button type="button" className="icon-btn live-feed-hide" onClick={onHideFeed} aria-label="Hide event feed">
          ✕
        </button>
      </div>
      <div className="event-list live-event-list" ref={listRef}>
        {items.length === 0 && (
          <div className="event-item live-event-empty">Waiting for events…</div>
        )}
        {items.map((ev) => (
          <div
            key={ev.id}
            className={`event-item live-event-item ${highlightIds.has(ev.id) ? 'live-event-new' : ''} ${selectedId === ev.id ? 'selected' : ''}`}
            onClick={() => selectPoint(ev)}
          >
            <div className="type" style={{ color: eventColor(ev.type) }}>{ev.type}</div>
            <div className="time">{fmtRelativeAgo(ev.gps_time, liveTick)} · {ev.speed ?? 0} km/h</div>
          </div>
        ))}
      </div>
    </>
  );
}

function LiveToasts({ toasts, liveTick, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map(({ toastId, event }) => (
        <div
          key={toastId}
          className={`toast toast-${event.type.replace(/\s+/g, '-')}`}
          style={{ borderLeftColor: eventColor(event.type) }}
        >
          <div className="toast-type" style={{ color: eventColor(event.type) }}>{event.type}</div>
          <div className="toast-meta">{fmtRelativeAgo(event.gps_time, liveTick)}</div>
          <button type="button" className="toast-dismiss" onClick={() => onDismiss(toastId)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
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
  const [mode, setMode] = useState(loadStoredMode);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [speed, setSpeed] = useState(4);
  const [loading, setLoading] = useState(false);
  const [livePos, setLivePos] = useState(null);
  const [dateWindow, setDateWindow] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [liveFollow, setLiveFollow] = useState(true);
  const [liveTick, setLiveTick] = useState(() => Date.now());
  const [showLiveFeed, setShowLiveFeed] = useState(loadShowLiveFeed);
  const [toasts, setToasts] = useState([]);
  const [highlightIds, setHighlightIds] = useState(() => new Set());
  const liveLastRef = useRef(null);
  const liveSinceIdRef = useRef(0);
  const liveEventIdsRef = useRef(new Set());
  const highlightTimersRef = useRef(new Map());

  const addToast = useCallback((event) => {
    const toastId = `toast-${event.id}-${Date.now()}`;
    setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { toastId, event }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
    }, 6000);
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
  }, []);

  const highlightEvent = useCallback((eventId) => {
    setHighlightIds((prev) => new Set(prev).add(eventId));
    const existing = highlightTimersRef.current.get(eventId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      setHighlightIds((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
      highlightTimersRef.current.delete(eventId);
    }, 4000);
    highlightTimersRef.current.set(eventId, timer);
  }, []);

  useEffect(() => {
    if (mode !== 'live') return undefined;
    const id = setInterval(() => setLiveTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // ignore unavailable storage
    }
  }, [mode]);

  useEffect(() => {
    try {
      localStorage.setItem(LIVE_FEED_STORAGE_KEY, showLiveFeed ? 'true' : 'false');
    } catch {
      // ignore unavailable storage
    }
  }, [showLiveFeed]);

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

  const applyLiveRow = useCallback((row, { notify = true } = {}) => {
    liveSinceIdRef.current = Math.max(liveSinceIdRef.current, row.id);
    if (row.type === 'move') {
      if (isStationaryMove(row)) return;
      const last = liveLastRef.current;
      if (last && !isPlausibleStep(last, row)) return;
      liveLastRef.current = row;
      setLivePos(row);
      setTrack((prev) => {
        const next = [...prev, row];
        return next.length > 500 ? next.slice(-500) : next;
      });
    } else {
      if (liveEventIdsRef.current.has(row.id)) return;
      liveEventIdsRef.current.add(row.id);
      setEvents((prev) => [row, ...prev].slice(0, MAX_LIVE_EVENTS));
      if (notify) {
        highlightEvent(row.id);
        if (isLiveToastType(row.type)) addToast(row);
      }
    }
  }, [addToast, highlightEvent]);

  useEffect(() => {
    if (mode !== 'live' || !trackerId) return;

    let cancelled = false;
    liveLastRef.current = null;
    liveSinceIdRef.current = 0;
    liveEventIdsRef.current = new Set();
    setTrack([]);
    setEvents([]);
    setLivePos(null);

    const poll = async () => {
      try {
        const [rows, trackerRows] = await Promise.all([
          fetchJson(
            `/api/live/poll?tracker_id=${trackerId}&since_id=${liveSinceIdRef.current}`
          ),
          fetchJson('/api/trackers'),
        ]);
        if (cancelled) return;
        setTrackers(trackerRows);
        for (const row of rows) applyLiveRow(row);
      } catch (err) {
        if (!cancelled) console.error(err);
      }
    };

    (async () => {
      try {
        const eventTypes = ALL_TYPES.filter((t) => t !== 'move').join(',');
        const fromIso = new Date(Date.now() - LIVE_EVENTS_HOURS * 3600000).toISOString();
        const [latestRows, eventRows] = await Promise.all([
          fetchJson(`/api/positions/latest?tracker_id=${trackerId}`),
          fetchJson(`/api/events?tracker_id=${trackerId}&from=${encodeURIComponent(fromIso)}&types=${encodeURIComponent(eventTypes)}`),
        ]);
        if (cancelled) return;

        if (eventRows.length) {
          setEvents(eventRows.slice(0, MAX_LIVE_EVENTS));
          liveEventIdsRef.current = new Set(eventRows.map((e) => e.id));
        }

        if (latestRows[0]) {
          const pt = latestRows[0];
          liveSinceIdRef.current = pt.id;
          liveLastRef.current = pt;
          setLivePos(pt);
          if (pt.type === 'move' && !isStationaryMove(pt) && pt.lat != null && pt.lng != null) {
            setTrack([pt]);
          }
        }
      } catch (err) {
        if (!cancelled) console.error(err);
      }
      if (!cancelled) poll();
    })();

    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode, trackerId, applyLiveRow]);

  useEffect(() => {
    if (!playing || track.length === 0) return;
    const ms = Math.max(50, 500 / speed);
    const id = setInterval(() => {
      setFrame((f) => (f >= track.length - 1 ? (setPlaying(false), f) : f + 1));
    }, ms);
    return () => clearInterval(id);
  }, [playing, track.length, speed]);

  useEffect(() => {
    if (mode === 'live') {
      setPlaying(false);
      setLiveFollow(true);
      setToasts([]);
      setHighlightIds(new Set());
    }
  }, [mode, trackerId]);

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
    const items = events.filter((e) => e.type !== 'move' && types.has(e.type));
    items.sort((a, b) => new Date(b.gps_time) - new Date(a.gps_time));
    return items;
  }, [events, types]);

  const liveStreamItems = useMemo(() => {
    if (mode !== 'live') return [];
    return [...events]
      .filter((e) => e.type !== 'move')
      .sort((a, b) => new Date(b.gps_time) - new Date(a.gps_time))
      .slice(0, MAX_LIVE_EVENTS);
  }, [events, mode]);

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
        if (e.type !== 'move' && e.lat != null && e.lng != null) items.push(e);
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

  const liveLastSeen = useMemo(() => {
    if (mode !== 'live') return null;
    const times = [];
    if (tracker?.last_seen) times.push(new Date(tracker.last_seen).getTime());
    if (current?.gps_time) times.push(new Date(current.gps_time).getTime());
    if (!times.length) return null;
    return new Date(Math.max(...times)).toISOString();
  }, [mode, tracker?.last_seen, current?.gps_time]);

  const loadedMove = types.has('move') ? track.length : 0;
  const loadedEvents = events.filter((e) => types.has(e.type)).length;
  const loadedTotal = loadedMove + loadedEvents;
  const windowTotal = windowStats?.total ?? loadedTotal;

  const toolbarProps = {
    trackers, trackerId, setTrackerId, from, setFrom, to, setTo, setDateWindow,
    mode, types, toggleType, dateWindow, applyDateWindow, loadData, loading,
    setMode,
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
        <span className="mobile-title">
          TK103B · {mode === 'live' ? (
            <span className="live-label">Live <span className="live-dot" aria-hidden="true" /></span>
          ) : 'Replay'}
        </span>
        <button
          type="button"
          className={`icon-btn events-toggle ${eventsOpen ? 'on' : ''}`}
          onClick={() => setEventsOpen((o) => !o)}
          hidden={mode === 'live'}
        >
          Events {mode !== 'live' && sidebarItems.length > 0 && `(${sidebarItems.length})`}
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

      {eventsOpen && mode !== 'live' && (
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

      <div className={`main ${mode === 'live' ? 'main-live' : ''} ${mode === 'live' && !showLiveFeed ? 'main-live-no-feed' : ''}`}>
        <div className="map-wrap">
          <LiveToasts toasts={toasts} liveTick={liveTick} onDismiss={dismissToast} />
          <MapView
            track={replayTrack}
            boundsTrack={track}
            markers={mapMarkers}
            current={current}
            isLive={mode === 'live'}
            followEnabled={liveFollow}
            onUserMove={() => setLiveFollow(false)}
            onRecenter={() => setLiveFollow(true)}
            selectedId={selectedId}
            onSelectPoint={selectPoint}
            pointPopup={pointPopup}
          />
        </div>

        {mode === 'live' && showLiveFeed && (
          <aside className="sidebar live-feed">
            <LiveEventStream
              items={liveStreamItems}
              liveTick={liveTick}
              highlightIds={highlightIds}
              selectedId={selectedId}
              selectPoint={selectPoint}
              onHideFeed={() => setShowLiveFeed(false)}
            />
          </aside>
        )}

        {mode !== 'live' && (
          <aside className="sidebar desktop-only">
            <EventsList {...eventsProps} />
          </aside>
        )}
      </div>

      <footer className={`status-bar ${mode === 'live' ? 'status-bar-live' : ''}`}>
        {mode === 'live' ? (
          liveLastSeen || current ? (
            <>
              <span className="stat stat-live-primary">
                Last seen{' '}
                <strong className={`live-age live-age-${liveUpdateFreshness(liveLastSeen || current?.gps_time, liveTick)}`}>
                  {fmtRelativeAgo(liveLastSeen || current?.gps_time, liveTick)}
                </strong>
              </span>
              <span className="stat">Speed: <strong>{current.speed ?? 0} km/h</strong></span>
              <span className="stat">Heading: <strong>{Math.round(current.angle ?? 0)}°</strong></span>
              <span className="stat">
                Map: <strong>{liveFollow ? 'Following' : 'Free pan'}</strong>
              </span>
              {track.length > 1 && (
                <span className="stat">
                  Path: <strong>{track.length} pts</strong>
                </span>
              )}
              <span className="stat">
                Events: <strong>{liveStreamItems.length}</strong>
                {!showLiveFeed && (
                  <>
                    {' · '}
                    <button type="button" className="link-btn" onClick={() => setShowLiveFeed(true)}>
                      Show feed
                    </button>
                  </>
                )}
              </span>
            </>
          ) : (
            <span className="stat">Waiting for position…</span>
          )
        ) : (
          <>
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
            {track.length > 0 && (
              <div className="replay-controls">
                <button
                  type="button"
                  className="play-btn"
                  onClick={() => setPlaying((p) => !p)}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? '⏸' : '▶'}
                </button>
                <select
                  className="speed-select"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  aria-label="Playback speed"
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                  <option value={8}>8x</option>
                  <option value={16}>16x</option>
                </select>
                <input
                  className="timeline"
                  type="range"
                  min={0}
                  max={track.length - 1}
                  value={frame}
                  onChange={(e) => { setFrame(Number(e.target.value)); setPlaying(false); }}
                />
                <span className="stat frame-counter">{frame + 1} / {track.length}</span>
              </div>
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
          </>
        )}
      </footer>
    </div>
  );
}
