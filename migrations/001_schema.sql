CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS tracker (
    id          BIGSERIAL PRIMARY KEY,
    imei        TEXT NOT NULL UNIQUE,
    label       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS car (
    id           BIGSERIAL PRIMARY KEY,
    tracker_id   BIGINT NOT NULL REFERENCES tracker(id) ON DELETE CASCADE,
    gps_time     TIMESTAMPTZ NOT NULL,
    date_created TIMESTAMPTZ NOT NULL DEFAULT now(),
    coords       geometry(Point, 4326) NOT NULL,
    type         VARCHAR(255) NOT NULL,
    speed        REAL,
    angle        REAL,
    ip           INET,
    original     TEXT
);

CREATE INDEX IF NOT EXISTS car_tracker_gps_time_idx ON car (tracker_id, gps_time DESC);
CREATE INDEX IF NOT EXISTS car_gps_time_idx ON car (gps_time DESC);
CREATE INDEX IF NOT EXISTS car_type_idx ON car (type);
CREATE INDEX IF NOT EXISTS car_coords_gix ON car USING GIST (coords);
CREATE INDEX IF NOT EXISTS car_tracker_type_gps_time_idx ON car (tracker_id, type, gps_time DESC);

CREATE OR REPLACE FUNCTION parse_gps_time(original TEXT, fallback TIMESTAMPTZ)
RETURNS TIMESTAMPTZ AS $$
DECLARE
    parts TEXT[];
    dt    TEXT;
    d     TEXT[];
BEGIN
    IF original IS NULL OR original = '' THEN
        RETURN fallback;
    END IF;

    parts := string_to_array(original, ',');
    IF array_length(parts, 1) < 3 OR length(parts[3]) < 12 THEN
        RETURN fallback;
    END IF;

    dt := parts[3];
    d := regexp_split_to_array(dt, '');
    RETURN make_timestamptz(
        2000 + d[1]::INT * 10 + d[2]::INT,
        d[3]::INT * 10 + d[4]::INT,
        d[5]::INT * 10 + d[6]::INT,
        d[7]::INT * 10 + d[8]::INT,
        d[9]::INT * 10 + d[10]::INT,
        d[11]::INT * 10 + d[12]::INT,
        'UTC'
    );
EXCEPTION WHEN OTHERS THEN
    RETURN fallback;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION extract_imei(original TEXT)
RETURNS TEXT AS $$
BEGIN
    IF original IS NULL OR original NOT LIKE 'imei:%' THEN
        RETURN NULL;
    END IF;
    RETURN split_part(split_part(original, ',', 1), ':', 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
