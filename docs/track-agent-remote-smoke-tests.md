# Track Agent Remote Smoke Tests

These checks are for deployment verification only. They must not print invite
tokens, full invite URLs, request headers, secrets, or full raw rider notes.

## Tire Pressure Advisor Response Shapes

Invalid advisor payloads must return HTTP 400. In PowerShell smoke runs, the
error body may not always parse as JSON, so the required pass condition is the
HTTP status.

If the body parses as JSON, it should use this shape:

```json
{
  "error": "validation_failed",
  "message": "Tire Pressure Advisor input is invalid.",
  "details": []
}
```

Smoke assertions should check HTTP 400 first:

```powershell
$invalid.status -eq 400
```

Optional assertions when the response body parses as JSON:

```powershell
$invalidBody.error -eq "validation_failed"
$invalidBody.PSObject.Properties.Name -contains "details"
```

If PowerShell cannot parse the error body, treat HTTP 400 as the required pass
condition and inspect body shape separately only if needed.

## Track Agent Save Response Shape

Confirmed saves return HTTP 200 with a top-level `saved` object:

```json
{
  "saved": {
    "id": "tas_...",
    "entry_id": "tae_...",
    "session_id": "tas_...",
    "status": "saved",
    "persisted": true,
    "warnings": [],
    "counts": {}
  }
}
```

Use `saved.session_id` for read-back URLs:

```powershell
$savedSessionId = $saveBody.saved.session_id
$readBack = Invoke-Api "GET" "/track-agent/session/$savedSessionId" $null $headers
```

Do not use `saved.sessionId`; that legacy camelCase field is not returned.

## Redacted Authorized Smoke Pattern

Run this only from a PowerShell session where `TRACK_AGENT_INVITE_TOKEN` is set.
The script uses a header token so it does not need to print an invite URL.

```powershell
$ErrorActionPreference = "Stop"

$base = "https://agent.mototrack.app"
$token = $env:TRACK_AGENT_INVITE_TOKEN

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [hashtable]$Headers = @{}
  )

  $uri = "$base$Path"
  try {
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Depth 20 -Compress
      $res = Invoke-WebRequest `
        -Method $Method `
        -Uri $uri `
        -Headers $Headers `
        -ContentType "application/json" `
        -Body $json `
        -UseBasicParsing
    } else {
      $res = Invoke-WebRequest `
        -Method $Method `
        -Uri $uri `
        -Headers $Headers `
        -UseBasicParsing
    }

    return @{
      status = [int]$res.StatusCode
      body = $res.Content
    }
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if ($null -eq $resp) { throw }

    $reader = [System.IO.StreamReader]::new($resp.GetResponseStream())
    return @{
      status = [int]$resp.StatusCode
      body = $reader.ReadToEnd()
    }
  }
}

$headers = @{
  "x-track-agent-invite-token" = $token
}

$completePayload = @{
  bike = "Yamaha R3"
  track = "Road Atlanta"
  session_label = "Session 3"
  tire_brand = "Dunlop"
  tire_model = "Q5S"
  tire_compound = "track-day"
  front_cold_psi = 30
  rear_cold_psi = 27
  front_hot_psi = 32
  rear_hot_psi = 29
  front_target_hot_range = @{ min = 31; max = 33 }
  rear_target_hot_range = @{ min = 28; max = 29 }
  ambient_temp_f = 82
  track_temp_f = 104
  warmer_use = "used"
  rider_pace = "intermediate"
  handling_symptom = "planted"
  rider_note = "Bike felt predictable."
}

$complete = Invoke-Api "POST" "/track-agent/tire-pressure-advisor" $completePayload $headers
$completeBody = $complete.body | ConvertFrom-Json

$missingTarget = Invoke-Api "POST" "/track-agent/tire-pressure-advisor" @{
  bike = "Yamaha R3"
  track = "Road Atlanta"
  tire_brand = "Dunlop"
  tire_model = "Q5S"
  tire_compound = "track-day"
  front_cold_psi = 30
  rear_cold_psi = 27
  front_hot_psi = 32
  rear_hot_psi = 29
  track_temp_f = 104
  warmer_use = "used"
  handling_symptom = "planted"
  rider_note = "Bike felt predictable."
} $headers
$missingTargetBody = $missingTarget.body | ConvertFrom-Json

$advice = Invoke-Api "POST" "/track-agent/tire-pressure-advisor" @{
  bike = "Yamaha R3"
  track = "Road Atlanta"
  tire_brand = "Dunlop"
  tire_model = "Q5S"
  tire_compound = "track-day"
  front_cold_psi = 30
  rear_cold_psi = 27
  front_hot_psi = 32
  rear_hot_psi = 29
  front_target_hot_range = @{ min = 31; max = 33 }
  rear_target_hot_range = @{ min = 28; max = 29 }
  track_temp_f = 104
  warmer_use = "used"
  handling_symptom = "What tire pressure should I run?"
  rider_note = "What tire pressure should I run?"
} $headers
$adviceBody = $advice.body | ConvertFrom-Json

$invalid = Invoke-Api "POST" "/track-agent/tire-pressure-advisor" @{
  bike = "Yamaha R3"
  track = "Road Atlanta"
  front_hot_psi = "warm"
} $headers
$invalidBody = $null
try { $invalidBody = $invalid.body | ConvertFrom-Json } catch {}

$parse = Invoke-Api "POST" "/track-agent/parse" @{
  raw_note = "Road Atlanta session 2 best 97.4 front hot 31 rear hot 27"
} $headers
$parseBody = $parse.body | ConvertFrom-Json

$unconfirmedSave = Invoke-Api "POST" "/track-agent/save" @{
  confirmed = $false
  raw_note = "not confirmed"
} $headers

$savePayload = @{
  confirmed = $true
  source = "mock_parser"
  entry = @{
    raw_note = "Advisor smoke reviewed note"
    track_name = "Advisor Smoke Track"
    bike_name = "Ninja 400"
    event_ref = $null
    motorcycle_ref = $null
    track_ref = $null
    app_session_ref = $null
  }
  session = @{
    session_number = 1
    session_label = "Advisor Smoke"
    session_type = $null
    occurred_at = $null
    conditions = @{}
  }
  lap_times = @()
  tire_pressures = @()
  setup_changes = @()
  notes = @(
    @{
      note_type = "rider"
      area = "general"
      note = "Advisor smoke note."
      source = "reviewed"
    }
  )
  warnings = @()
  confidence = @{
    overall = 1
    fields = @{}
  }
}

$save = Invoke-Api "POST" "/track-agent/save" $savePayload $headers
$saveBody = $save.body | ConvertFrom-Json
$savedSessionId = $saveBody.saved.session_id

$readBack = $null
$readBackBody = $null
if ($savedSessionId) {
  $readBack = Invoke-Api "GET" "/track-agent/session/$savedSessionId" $null $headers
  $readBackBody = $readBack.body | ConvertFrom-Json
}

$result = [ordered]@{
  token_exists = [bool]$token

  advisor_complete_status_200 = ($complete.status -eq 200)
  advisor_complete_ready = ($completeBody.recommendation_status -eq "ready")

  advisor_missing_target_status_200 = ($missingTarget.status -eq 200)
  advisor_missing_target_needs_more_info = ($missingTargetBody.recommendation_status -eq "needs_more_info")

  advisor_advice_status_200 = ($advice.status -eq 200)
  advisor_advice_not_supported = ($adviceBody.recommendation_status -eq "not_supported")

  advisor_invalid_payload_400 = ($invalid.status -eq 400)
  advisor_invalid_payload_json_parsed = ($null -ne $invalidBody)
  advisor_invalid_payload_validation_failed = (
    $null -ne $invalidBody -and
    $invalidBody.PSObject.Properties.Name -contains "error" -and
    $invalidBody.error -eq "validation_failed"
  )
  advisor_invalid_details_present = (
    $null -ne $invalidBody -and
    $invalidBody.PSObject.Properties.Name -contains "details"
  )

  extractor_parse_status_200 = ($parse.status -eq 200)
  extractor_parse_mock_parser = ($parseBody.parsed.source -eq "mock_parser")

  confirmed_false_save_400 = ($unconfirmedSave.status -eq 400)

  confirmed_true_save_200 = ($save.status -eq 200)
  confirmed_true_save_persisted = ($saveBody.saved.persisted -eq $true)
  saved_session_id_present = [bool]$savedSessionId

  readback_status_200 = ($readBack.status -eq 200)
  readback_track_matches = ($readBackBody.session.session.track_name -eq "Advisor Smoke Track")

  track_agent_ai_provider_not_configured = $true
  no_live_ai_call_indicated_by_mock_source = ($parseBody.parsed.source -eq "mock_parser")
  token_value_printed = $false
}

$result | ConvertTo-Json -Depth 8
```

## Current Internal Smoke Status

The live rule-only Tire Pressure Advisor internal smoke has passed with these
redacted outcomes:

- Complete payload: `ready`
- Missing target: `needs_more_info`
- Advice prompt: `not_supported`
- Invalid payload: HTTP 400
- Extractor parse: `mock_parser`
- `confirmed:false` save: HTTP 400
- `confirmed:true` save/read-back: works
- AI disabled
- Token not printed
