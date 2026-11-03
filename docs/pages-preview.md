# Manual Pages preview

The `Review preview` workflow publishes only `runs/2026-10-28` as the site's `index.html` at
`https://nortus222.github.io/mega-s01e04-before-i-looked/`. It runs only when manually dispatched
from `main`; it does not enable Pages. Repository Pages must first be configured to use GitHub
Actions by the repository owner.

Before dispatching **review**, the repository owner must configure the Actions secret
`LANE_MARKER` with the marker approved for this review. The workflow refuses an empty marker.
Before dispatching **cleanup**, the reviewer must have completed review and the human owner must
approve replacing the page with the marker-free version. Dispatch cleanup as a separate run; it
unsets `LANE_MARKER` and verifies the `no marker set` banner. Obtain human approval separately
before each dispatch. Both runs delete their exact uploaded Actions artifact after deployment,
with a one-day retention fallback.

The workflow cannot be dispatched from this feature branch; it becomes available after the
owner merges the prepared workflow to `main`. This preparation does not configure Pages, set
secrets, dispatch either phase, or publish a page.
