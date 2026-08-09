// The single canonical MotoTrack application version. One source of truth: the
// Worker reads it, the Feedback intake stamps it server-side, and later work
// will surface this same value to the static Log app (served by the Worker)
// rather than letting the browser define its own. The value is never
// rider-supplied or inferred from arbitrary browser data.
//
// Increment this canonical application version when a reviewed MotoTrack Log
// release materially changes the rider experience. Feedback and Experience
// Pulse records read this value; they must not define their own version
// strings. Do not create a second version registry, and do not add a build
// system merely to generate this value. If a deployment-time Git SHA/build
// identifier is ever available, it may be captured as an ADDITIONAL
// deployment-context field without changing this canonical value.
//
// This is an INTERNAL canonical application-version identifier, not a
// billing/plan/version marketing claim. MotoTrack Log has not declared 1.0.
export const APP_VERSION = "0.1.0-beta.1";
