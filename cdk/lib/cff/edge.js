// CloudFront Function (JS runtime 2.0) — viewer-request, associated with every
// monetized route behavior (/weather, /sports, /main.html).
//
// Edge order is: AWS WAF  ->  this CloudFront Function  ->  origin.
// So WAF runs FIRST: an unpaid request gets a 402 from WAF and NEVER reaches this
// function. Only a PAID request gets here — at which point we synthesize a mock
// response. We demonstrate THREE content types so the buyer's renderer can show
// JSON, Markdown, and HTML:
//
//   /weather     -> application/json   (a weather reading; geo-aware + randomized)
//   /sports      -> text/markdown      (a scores digest; randomized)
//   /main.html   -> text/html          (a rich landing page)
function handler(event) {
  var req = event.request;
  var uri = req.uri || "/";
  var countryHeader = req.headers["cloudfront-viewer-country"];
  var country = countryHeader && countryHeader.value ? countryHeader.value : "US";

  function resp(contentType, body) {
    return {
      statusCode: 200,
      statusDescription: "OK",
      headers: {
        "content-type": { value: contentType },
        "cache-control": { value: "no-store" },
        "access-control-allow-origin": { value: "*" },
      },
      body: body,
    };
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  if (uri.indexOf("/sports") === 0) {
    // Fictional teams (no real clubs).
    var teams = ["Nimbus FC", "Vortex United", "Pixel Rovers", "Quasar SC", "Cobalt Kings",
      "Ember Owls", "Lunar Tide", "Granite Wolves", "Solstice AC", "Drift City"];
    function match() {
      var a = pick(teams), b = pick(teams);
      while (b === a) b = pick(teams); // a team never plays itself
      var st = pick(["FT", "Q4", "Live", "HT", "90'+3"]);
      return "| " + a + " vs " + b + " | " + rint(0, 5) + " – " + rint(0, 5) + " | " + st + " |";
    }
    var md =
      "# Sports — paid digest\n\n" +
      "_You only see this because AWS WAF verified your x402 payment._\n\n" +
      "Updated for **" + country + "** · ref #" + rint(1000, 9999) + "\n\n" +
      "| Match | Score | Status |\n" +
      "|-------|-------|--------|\n" +
      match() + "\n" + match() + "\n" + match() + "\n\n" +
      "> Served by a CloudFront Function at the edge.";
    return resp("text/markdown", md);
  }

  if (uri.indexOf("/main.html") === 0) {
    var hero = pick(["#0052ff", "#7c3aed", "#0891b2", "#059669"]);
    var html =
      '<!-- paid HTML fragment, unlocked via x402 -->\n' +
      '<article style="font-family:system-ui;color:#0a0b0d;line-height:1.5">' +
        '<div style="background:linear-gradient(135deg,' + hero + ',#0a0b0d);color:#fff;border-radius:14px;padding:22px 24px;margin-bottom:16px">' +
          '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.8">Premium · Members only</div>' +
          '<h1 style="margin:6px 0 4px;font-size:26px">The Edge Dispatch</h1>' +
          '<p style="margin:0;opacity:.9">Unlocked for a reader in ' + country + ' · issue #' + rint(100, 999) + '</p>' +
        '</div>' +
        '<p style="margin:0 0 14px">This is a <strong>real HTML document</strong> served only after AWS WAF verified your x402 payment — rendered live in the page, not as escaped text.</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
          '<div style="border:1px solid #dee1e6;border-radius:10px;padding:12px"><div style="font-size:22px">⚡</div><b>No Lambda@Edge</b><div style="color:#5b616e;font-size:13px">WAF speaks x402 directly.</div></div>' +
          '<div style="border:1px solid #dee1e6;border-radius:10px;padding:12px"><div style="font-size:22px">🔒</div><b>Priced at the edge</b><div style="color:#5b616e;font-size:13px">402 before any origin hit.</div></div>' +
        '</div>' +
        '<blockquote style="margin:0;border-left:3px solid ' + hero + ';padding:6px 14px;color:#5b616e">“Pay-per-request content, settled on Base Sepolia.”</blockquote>' +
        '<p style="margin:14px 0 0;font-size:12px;color:#7c828a">Served by a CloudFront Function · build ' + rint(10000, 99999) + '</p>' +
      '</article>';
    return resp("text/html", html);
  }

  // default: /weather → JSON (randomized)
  var tempC = rint(8, 31);
  var weather = {
    service: "x402-weather",
    country: country,
    tempC: tempC,
    tempF: Math.round(tempC * 1.8 + 32),
    condition: pick(["Sunny", "Partly cloudy", "Cloudy", "Light rain", "Thunderstorms", "Clear", "Windy", "Foggy"]),
    humidity: rint(30, 90) + "%",
    windKph: rint(3, 40),
    note: "Paid weather — you only see this because AWS WAF verified your x402 payment.",
    servedBy: "cloudfront-function-at-edge",
  };
  return resp("application/json", JSON.stringify(weather));
}
