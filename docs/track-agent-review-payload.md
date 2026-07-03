# Track Agent reviewed payload

Track Agent parses a rider's raw note, but parsed data is never saved directly.
The review UI must send a confirmed reviewed payload to `POST /track-agent/save`.

## Canonical shape

```json
{
  "confirmed": true,
  "source": "manual_review",
  "entry": {
    "raw_note": "Session 2 at Road Atlanta on the Ninja 400...",
    "track_name": "Road Atlanta",
    "bike_name": "Ninja 400",
    "event_ref": null,
    "motorcycle_ref": null,
    "track_ref": null,
    "app_session_ref": null
  },
  "session": {
    "session_number": 2,
    "session_label": "Session 2",
    "session_type": "practice",
    "occurred_at": null,
    "conditions": {
      "weather": null,
      "track_temp": null,
      "air_temp": null
    }
  },
  "lap_times": [
    {
      "lap_number": null,
      "lap_time": "1:37.4",
      "is_best": true,
      "source": "rider_note"
    }
  ],
  "tire_pressures": [
    {
      "position": "front",
      "timing": "hot",
      "pressure_psi": 31,
      "source": "rider_note"
    }
  ],
  "setup_changes": [
    {
      "timing": "before Session 3",
      "component": "rear shock",
      "adjustment": "rebound",
      "change": "softened 1 click",
      "source": "rider_note"
    }
  ],
  "notes": [
    {
      "note_type": "handling",
      "area": "Turn 8 exit",
      "note": "Bike felt loose on exit.",
      "source": "rider_note"
    }
  ],
  "warnings": [],
  "confidence": {
    "overall": 0.82,
    "fields": {}
  }
}
```

## Required fields

- `confirmed` must be `true`.
- `entry.raw_note` is required.

Everything else can be partial. Missing track, bike, session number, lap times,
tire pressures, setup changes, and notes should produce warnings or be accepted
as incomplete reviewed data rather than hard failures.

## Validation behavior

- `session.session_number` may be `null`; if present, it must be numeric.
- `lap_times[].lap_time` may be `null`; if present, it must be a string.
- `tire_pressures[].pressure_psi` may be `null`; if present, it must be numeric.
- `tire_pressures[].position` supports `front`, `rear`, and `unknown`.
- `tire_pressures[].timing` supports `cold`, `hot`, `before`, `after`, and
  `unknown`. Legacy `pre` and `post` are normalized to `before` and `after`.
- `setup_changes`, `notes`, `warnings`, and `confidence` can be empty or
  partial.

## Compatibility

`normalizeReviewedTrackAgentPayload()` accepts the older mock parser payload so
current smoke tests can keep working while the review UI moves toward the
canonical shape.

## Raw note handling

`entry.raw_note` stores the full original rider note. `notes[]` stores only
reviewed or extracted rider notes. Track Agent does not automatically duplicate
the raw note into `notes[]`.

## Future AI and UI use

The AI/provider layer should eventually produce this shape as a draft. The
review UI should render it as editable fields, let the rider correct anything,
and send the confirmed canonical payload only after the rider approves it.
