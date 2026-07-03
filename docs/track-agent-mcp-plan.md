# Track Agent MCP plan

Track Agent service functions should be shaped so they can later be exposed as
MCP tools. MCP is not implemented in this scaffold.

## Future tools

| Future MCP tool | Current internal service function |
| --- | --- |
| `create_track_agent_session` | `saveReviewedTrackAgentSession()` |
| `log_track_agent_lap_time` | Future D1 write helper for `track_agent_lap_times` |
| `log_track_agent_tire_pressure` | Future D1 write helper for `track_agent_tire_pressures` |
| `log_track_agent_setup_change` | Future D1 write helper for `track_agent_setup_changes` |
| `add_track_agent_rider_note` | Future D1 write helper for `track_agent_notes` |
| `summarize_track_agent_day` | `summarizeTrackAgentDay()` |

## Notes

- MCP tools should operate on Track Agent D1 data only.
- Do not expose or mutate the free MotoTrack Log `mototrack.sessions.v1`
  localStorage data through MCP.
- AI-parsed data must still go through review and confirmation before any
  persistence tool writes it.
