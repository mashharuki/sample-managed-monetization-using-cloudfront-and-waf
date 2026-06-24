/**
 * The monetized routes. Each one becomes:
 *   - a CloudFront behavior (path pattern) wired to the weather CloudFront Function,
 *   - a WAF `Monetize` rule (so WAF returns 402 for it), and
 *   - an entry in the SPA's config.js so the buyer can pick it.
 *
 * Adding a route is a single entry here. `contentType` is just a hint the buyer's
 * renderer uses to pick JSON / Markdown / HTML formatting; the CloudFront Function
 * is what actually emits the body.
 */
export interface RouteSpec {
  /** Path the behavior matches and the buyer calls, e.g. "/weather". */
  path: string;
  /** Short label for the buyer's route picker. */
  label: string;
  /** Renderer hint: how the buyer formats the 200 body. */
  contentType: "json" | "markdown" | "html";
  /** Price multiplier × the WebACL base Amount. */
  priceMultiplier: number;
}

export const ROUTES: RouteSpec[] = [
  { path: "/weather", label: "Weather (JSON)", contentType: "json", priceMultiplier: 1 },
  { path: "/sports", label: "Sports (Markdown)", contentType: "markdown", priceMultiplier: 2 },
  { path: "/main.html", label: "Landing (HTML)", contentType: "html", priceMultiplier: 1 },
];
