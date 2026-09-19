import type { UsageStats } from "./usage.js";

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const interactionSubmitGuardScript = `
(() => {
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.rrSubmitting === "1") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    form.dataset.rrSubmitting = "1";
    form.setAttribute("aria-busy", "true");

    queueMicrotask(() => {
      for (const control of form.querySelectorAll('button[type="submit"],input[type="submit"]')) {
        control.setAttribute("aria-disabled", "true");
        control.style.pointerEvents = "none";
      }
    });
  }, true);
})();
`;

function page(title: string, body: string, wide = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Range Remote</title>
<script src="/auth/ui.js" defer></script>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#15171a;margin:0}
main{max-width:${wide ? "1040px" : "480px"};margin:6vh auto;padding:24px}
.card{background:#fff;border:1px solid #e3e6ea;border-radius:18px;padding:28px;box-shadow:0 10px 30px #0000000a}
h1{font-size:24px;margin:0 0 8px}p{line-height:1.55;color:#555}
label{display:block;margin-top:16px;font-weight:600}
input{box-sizing:border-box;width:100%;margin-top:7px;padding:12px;border:1px solid #cbd0d6;border-radius:10px;font:inherit}
button,.button{display:inline-block;margin-top:20px;background:#15171a;color:#fff;border:0;border-radius:10px;padding:12px 16px;font:inherit;text-decoration:none;cursor:pointer}
.secondary{background:#eef0f2;color:#15171a;margin-left:8px}.error{color:#a40018}.scopes{padding-left:20px}
.small{font-size:14px}
.usage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}.usage-head p{margin:4px 0}.usage-head form{margin:0}.usage-head button{margin:0}
.hero{display:flex;align-items:end;justify-content:space-between;gap:20px;padding:22px;border-radius:16px;background:#15171a;color:#fff;margin:18px 0}.hero .label{font-size:14px;color:#c5c8cc}.hero .number{font-size:42px;font-weight:750;line-height:1.05;margin-top:6px}.hero .muted{color:#c5c8cc;font-size:13px;margin-top:7px}.pill{display:inline-block;border:1px solid #ffffff33;border-radius:999px;padding:6px 10px;font-size:13px;color:#fff}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.metric{border:1px solid #e3e6ea;border-radius:14px;padding:16px;background:#fff}.metric .k{color:#737980;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.metric .v{font-size:24px;font-weight:700;margin-top:5px}
.section{margin-top:22px}.section h2{font-size:17px;margin:0 0 10px}.chart{height:150px;display:flex;align-items:end;gap:4px;padding:12px 4px 4px;border-bottom:1px solid #dfe3e7}.bar{flex:1;min-width:3px;background:#15171a;border-radius:4px 4px 0 0;opacity:.86}.bar.zero{opacity:.12}.chart-labels{display:flex;justify-content:space-between;color:#858b92;font-size:11px;margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;border-bottom:1px solid #edf0f2;padding:10px 8px}th{color:#6d737a;font-size:12px;font-weight:600}.right{text-align:right}.ok{color:#18794e}.bad{color:#b42318}.empty{padding:20px;border:1px dashed #ccd1d7;border-radius:12px;color:#6b7178;text-align:center}.footer-note{margin-top:22px;font-size:12px;color:#858b92}
@media(max-width:760px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.usage-head{display:block}.usage-head form{margin-top:12px}.hero{align-items:flex-start;flex-direction:column}.hero .number{font-size:36px}table{font-size:12px}th,td{padding:9px 5px}}
</style>
</head><body><main><div class="card">${body}</div></main></body></html>`;
}

export function loginPage(uid: string, csrf: string, clientName: string, error?: string): string {
  return page("Sign in", `
<h1>Sign in to Range Remote</h1>
<p><strong>${esc(clientName)}</strong> is requesting access to your paired computers.</p>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/interaction/${esc(uid)}/login">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label>Username or email<input name="login" autocomplete="username" required></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
</form>
<p class="small">Need an account? <a href="/register?returnTo=/interaction/${esc(uid)}">Create one</a>.</p>`);
}
export function consentPage(
  uid: string,
  csrf: string,
  clientName: string,
  scopes: string[]
): string {
  const items = scopes.map((scope) => `<li>${esc(scope)}</li>`).join("");
  return page("Authorize", `
<h1>Allow access?</h1>
<p><strong>${esc(clientName)}</strong> wants to use Range Remote on your behalf.</p>
<ul class="scopes">${items || "<li>Basic account access</li>"}</ul>
<form method="post" action="/interaction/${esc(uid)}/consent">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<button type="submit" name="decision" value="allow">Allow</button>
<button class="secondary" type="submit" name="decision" value="deny">Deny</button>
</form>`);
}

export function registerPage(returnTo: string, csrf: string, error?: string): string {
  return page("Create account", `
<h1>Create Range Remote account</h1>
<p>This account controls which paired computers ChatGPT may access.</p>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/register">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<input type="hidden" name="returnTo" value="${esc(returnTo)}">
<label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="40"></label>
<label>Email<input type="email" name="email" autocomplete="email" required></label>
<label>Password<input type="password" name="password" autocomplete="new-password" required minlength="8"></label>
<button type="submit">Create account</button>
</form>`);
}

export function homePage(registrationEnabled: boolean): string {
  return page("Authorization server", `
<h1>Range Remote Authorization</h1>
<p>OAuth 2.1 / OpenID Connect authorization service for Range Remote.</p>
<p class="small">Accounts are used only to authorize access to explicitly paired devices.</p>
${registrationEnabled ? '<a class="button" href="/register">Create account</a>' : ""}
<a class="button secondary" href="/usage">View usage</a>`);
}


export function usageLoginPage(csrf: string, error?: string): string {
  return page("Usage", `
<h1>Range Remote Usage</h1>
<p>Sign in with your Range Remote account to view private tool-call usage.</p>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/usage/login">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label>Username or email<input name="login" autocomplete="username" required></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">View usage</button>
</form>`);
}

export function usagePage(
  username: string,
  csrf: string,
  stats: UsageStats
): string {
  const month = stats.thisMonth;
  const successPercent = (month.successRate * 100).toFixed(month.calls ? 1 : 0);
  const maxDaily = Math.max(1, ...stats.daily.map((entry) => entry.calls));
  const bars = stats.daily.map((entry) => {
    const height = entry.calls === 0 ? 4 : Math.max(8, Math.round((entry.calls / maxDaily) * 100));
    return `<div class="bar${entry.calls === 0 ? " zero" : ""}" style="height:${height}%" title="${esc(entry.date)}: ${entry.calls} calls"></div>`;
  }).join("");
  const firstDay = stats.daily[0]?.date ?? "";
  const lastDay = stats.daily.at(-1)?.date ?? "";

  const toolRows = stats.topTools.map((tool) => `
<tr><td><code>${esc(tool.name)}</code></td><td class="right">${formatNumber(tool.calls)}</td><td class="right">${(tool.successRate * 100).toFixed(1)}%</td><td class="right">${formatDuration(tool.avgDurationMs)}</td></tr>`).join("");

  const recentRows = stats.recent.map((entry) => `
<tr><td>${esc(shortTimestamp(entry.at))}</td><td><code>${esc(entry.toolName)}</code></td><td>${esc(entry.deviceName ?? "—")}</td><td class="right ${entry.success ? "ok" : "bad"}">${entry.success ? "Success" : "Failed"}</td><td class="right">${formatDuration(entry.durationMs)}</td></tr>`).join("");

  return page("Usage", `
<div class="usage-head">
  <div><h1>Range Remote Usage</h1><p>Signed in as <strong>@${esc(username)}</strong></p></div>
  <form method="post" action="/usage/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="secondary" type="submit">Sign out</button></form>
</div>
<div class="hero">
  <div><div class="label">Tool calls this month</div><div class="number">${formatNumber(month.calls)}</div><div class="muted">No monthly usage cap is configured.</div></div>
  <span class="pill">Unlimited</span>
</div>
<div class="metrics">
  <div class="metric"><div class="k">Today</div><div class="v">${formatNumber(stats.todayCalls)}</div></div>
  <div class="metric"><div class="k">Success rate</div><div class="v">${successPercent}%</div></div>
  <div class="metric"><div class="k">Avg latency</div><div class="v">${formatDuration(month.avgDurationMs)}</div></div>
  <div class="metric"><div class="k">All-time calls</div><div class="v">${formatNumber(stats.totalCalls)}</div></div>
</div>
<div class="section"><h2>Last 30 days</h2><div class="chart">${bars}</div><div class="chart-labels"><span>${esc(firstDay)}</span><span>${esc(lastDay)}</span></div></div>
<div class="section"><h2>Top tools this month</h2>${toolRows ? `<table><thead><tr><th>Tool</th><th class="right">Calls</th><th class="right">Success</th><th class="right">Avg latency</th></tr></thead><tbody>${toolRows}</tbody></table>` : '<div class="empty">No tool calls recorded this month.</div>'}</div>
<div class="section"><h2>Recent activity</h2>${recentRows ? `<table><thead><tr><th>Time (UTC)</th><th>Tool</th><th>Device</th><th class="right">Result</th><th class="right">Latency</th></tr></thead><tbody>${recentRows}</tbody></table>` : '<div class="empty">No usage has been recorded yet.</div>'}</div>
<p class="footer-note">Usage tracking ${stats.trackingSince ? `started ${esc(shortTimestamp(stats.trackingSince))} UTC` : "starts with the first tool call after analytics was enabled"}. Calendar boundaries and chart dates use ${esc(stats.period.timezone)}. Only tool name, result status, duration, client/device identifiers, and time are stored; tool arguments and outputs are not stored in usage analytics.</p>`, true);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(value: number): string {
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function shortTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 16);
}
