// The single canonical MotoTrack application version. One source of truth: the
// Worker reads it, the Feedback intake stamps it server-side, and PR 2 will
// surface this same value to the static Log app (served by the Worker) rather
// than letting the browser define its own. Adding Feedback must not create a
// second version registry, and the value is never rider-supplied or inferred
// from arbitrary browser data.
//
// Bump this string on a meaningful app release. It is intentionally a plain
// constant: the static Log app has no build system, and Feedback must not
// depend on introducing one. If a deployment-time Git SHA/build identifier is
// ever available, it may be captured as an ADDITIONAL deployment-context field
// without changing this canonical value.
export const APP_VERSION = "1.0.0";
