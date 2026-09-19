import base64
import hashlib
import http.client
import json
import os
import re
import secrets
import urllib.parse

HOST = os.environ.get("RR_AUTH_HOST", "auth.localtest.me")
PORT = int(os.environ.get("RR_AUTH_PORT", "18790"))
MCP_HOST = os.environ.get("RR_MCP_HOST", "remote.localtest.me")
MCP_PORT = int(os.environ.get("RR_MCP_PORT", "18787"))
AUTH_ISSUER = os.environ.get("RR_AUTH_ISSUER", "https://auth.localtest.me")
MCP_RESOURCE = os.environ.get("RR_MCP_RESOURCE", "https://remote.localtest.me")
CALLBACK = os.environ.get("RR_CALLBACK", "https://chatgpt.com/connector_platform_oauth_redirect")

cookies = {}

def request(method, target, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    h = {
        "Host": HOST,
        "X-Forwarded-Proto": "https",
    }
    if cookies:
        h["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    if headers:
        h.update(headers)
    conn.request(method, target, body=body, headers=h)
    res = conn.getresponse()
    data = res.read()
    for key, value in res.getheaders():
        if key.lower() == "set-cookie":
            first = value.split(";", 1)[0]
            if "=" in first:
                name, val = first.split("=", 1)
                cookies[name] = val
    out = (res.status, dict(res.getheaders()), data)
    conn.close()
    return out

def form(target, fields):
    body = urllib.parse.urlencode(fields)
    return request(
        "POST",
        target,
        body=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

def hidden_csrf(html):
    m = re.search(rb'name="csrf" value="([^"]+)"', html)
    if not m:
        raise RuntimeError("CSRF token not found")
    return m.group(1).decode()

username = "smoke-" + secrets.token_hex(4)
email = username + "@example.com"
password = secrets.token_urlsafe(24)

status, _, body = request("GET", "/register")
assert status == 200, (status, body[:200])
csrf = hidden_csrf(body)
status, headers, body = form("/register", {
    "csrf": csrf,
    "returnTo": "",
    "username": username,
    "email": email,
    "password": password,
})
assert status in (302, 303), (status, body[:300])

dcr = json.dumps({
    "redirect_uris": [CALLBACK],
    "token_endpoint_auth_method": "none",
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "client_name": "Range Remote E2E",
})
status, _, body = request(
    "POST",
    "/reg",
    body=dcr,
    headers={"Content-Type": "application/json"},
)
assert status == 201, (status, body[:500])
client = json.loads(body)
client_id = client["client_id"]

verifier = secrets.token_urlsafe(48)
challenge = base64.urlsafe_b64encode(
    hashlib.sha256(verifier.encode()).digest()
).rstrip(b"=").decode()

base_auth = {
    "client_id": client_id,
    "redirect_uri": CALLBACK,
    "response_type": "code",
    "scope": "openid email offline_access remote:use",
    "prompt": "consent",
    "state": "negative-state",
}

no_pkce = urllib.parse.urlencode({
    **base_auth,
    "resource": MCP_RESOURCE,
})
status, headers, body = request("GET", "/auth?" + no_pkce)
assert status == 303, (status, body[:300])
negative = urllib.parse.parse_qs(urllib.parse.urlparse(headers["Location"]).query)
assert negative.get("error") == ["invalid_request"], negative
assert negative.get("iss") == [AUTH_ISSUER], negative

wrong_resource = urllib.parse.urlencode({
    **base_auth,
    "resource": "https://wrong.invalid",
    "code_challenge": challenge,
    "code_challenge_method": "S256",
})
status, headers, body = request("GET", "/auth?" + wrong_resource)
assert status == 303, (status, body[:300])
negative = urllib.parse.parse_qs(urllib.parse.urlparse(headers["Location"]).query)
assert negative.get("error") == ["invalid_target"], negative
assert negative.get("iss") == [AUTH_ISSUER], negative

query = urllib.parse.urlencode({
    "client_id": client_id,
    "redirect_uri": CALLBACK,
    "response_type": "code",
    "scope": "openid email offline_access remote:use",
    "prompt": "consent",
    "state": "e2e-state",
    "resource": MCP_RESOURCE,
    "code_challenge": challenge,
    "code_challenge_method": "S256",
})
status, headers, body = request("GET", "/auth?" + query)
assert status == 303, (status, body[:300])
location = headers["Location"]
assert location.startswith("/interaction/"), location

status, _, body = request("GET", location)
assert status == 200, (status, body[:300])
csrf = hidden_csrf(body)
status, headers, body = form(location + "/login", {
    "csrf": csrf,
    "login": username,
    "password": password,
})
assert status == 303, (status, body[:300])
location = headers["Location"]

for _ in range(5):
    status, headers, body = request("GET", location)
    if status == 200 and b"Allow access?" in body:
        break
    if status in (302, 303):
        location = headers["Location"]
        continue
    raise RuntimeError(f"unexpected resume response {status}: {body[:300]!r}")
else:
    raise RuntimeError("consent interaction not reached")

csrf = hidden_csrf(body)
status, headers, body = form(location + "/consent", {
    "csrf": csrf,
    "decision": "allow",
})
assert status == 303, (status, body[:300])
location = headers["Location"]

for _ in range(6):
    if location.startswith(CALLBACK):
        break
    status, headers, body = request("GET", location)
    assert status in (302, 303), (status, body[:300])
    location = headers["Location"]
else:
    raise RuntimeError("callback not reached")

callback = urllib.parse.urlparse(location)
params = urllib.parse.parse_qs(callback.query)
assert params.get("state") == ["e2e-state"], params
code = params["code"][0]

token_body = urllib.parse.urlencode({
    "grant_type": "authorization_code",
    "client_id": client_id,
    "redirect_uri": CALLBACK,
    "code": code,
    "code_verifier": verifier,
    "resource": MCP_RESOURCE,
})
status, _, body = request(
    "POST",
    "/token",
    body=token_body,
    headers={"Content-Type": "application/x-www-form-urlencoded"},
)
assert status == 200, (status, body[:500])
tokens = json.loads(body)
access_token = tokens["access_token"]
refresh_token = tokens.get("refresh_token")
assert refresh_token, tokens

parts = access_token.split(".")
assert len(parts) == 3, "access token is not JWT"
payload = parts[1] + "=" * (-len(parts[1]) % 4)
claims = json.loads(base64.urlsafe_b64decode(payload))
assert claims["aud"] == MCP_RESOURCE, claims
scope = claims.get("scope", "")
assert "remote:use" in scope.split(), claims

id_token = tokens["id_token"]
id_parts = id_token.split(".")
assert len(id_parts) == 3, "id token is not JWT"
id_payload = id_parts[1] + "=" * (-len(id_parts[1]) % 4)
id_claims = json.loads(base64.urlsafe_b64decode(id_payload))
assert id_claims["iss"] == AUTH_ISSUER, id_claims
assert id_claims["email"] == email, id_claims
assert id_claims.get("sub"), id_claims

refresh_body = urllib.parse.urlencode({
    "grant_type": "refresh_token",
    "client_id": client_id,
    "refresh_token": refresh_token,
    "resource": MCP_RESOURCE,
})
status, _, body = request(
    "POST",
    "/token",
    body=refresh_body,
    headers={"Content-Type": "application/x-www-form-urlencoded"},
)
assert status == 200, (status, body[:500])
refreshed = json.loads(body)
assert refreshed.get("access_token"), refreshed
refreshed_parts = refreshed["access_token"].split(".")
refreshed_payload = refreshed_parts[1] + "=" * (-len(refreshed_parts[1]) % 4)
refreshed_claims = json.loads(base64.urlsafe_b64decode(refreshed_payload))
assert refreshed_claims["aud"] == MCP_RESOURCE, refreshed_claims
assert refreshed_claims["sub"] == claims["sub"], refreshed_claims

mcp = http.client.HTTPConnection("127.0.0.1", MCP_PORT, timeout=5)
mcp_body = json.dumps({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "range-remote-e2e", "version": "1.0"},
    },
})
mcp.request(
    "POST",
    "/mcp",
    body=mcp_body,
    headers={
        "Host": MCP_HOST,
        "X-Forwarded-Proto": "https",
        "Authorization": "Bearer " + access_token,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    },
)
mcp_res = mcp.getresponse()
mcp_data = mcp_res.read()
assert mcp_res.status == 200, (mcp_res.status, mcp_data[:500])
mcp_session = mcp_res.getheader("Mcp-Session-Id")
content_type = mcp_res.getheader("Content-Type", "")
if content_type.startswith("text/event-stream"):
    data_lines = [
        line[5:].strip()
        for line in mcp_data.decode().splitlines()
        if line.startswith("data:")
    ]
    assert data_lines, mcp_data[:500]
    mcp_json = json.loads(data_lines[-1])
else:
    mcp_json = json.loads(mcp_data)
assert mcp_json.get("result", {}).get("serverInfo", {}).get("name") == "Range Remote", mcp_json
mcp.close()

tools_conn = http.client.HTTPConnection("127.0.0.1", MCP_PORT, timeout=5)
tools_headers = {
    "Host": MCP_HOST,
    "X-Forwarded-Proto": "https",
    "Authorization": "Bearer " + access_token,
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}
if mcp_session:
    tools_headers["Mcp-Session-Id"] = mcp_session
tools_conn.request(
    "POST",
    "/mcp",
    body=json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
    headers=tools_headers,
)
tools_res = tools_conn.getresponse()
tools_data = tools_res.read()
assert tools_res.status == 200, (tools_res.status, tools_data[:500])
tools_content_type = tools_res.getheader("Content-Type", "")
if tools_content_type.startswith("text/event-stream"):
    tool_lines = [
        line[5:].strip()
        for line in tools_data.decode().splitlines()
        if line.startswith("data:")
    ]
    tools_json = json.loads(tool_lines[-1])
else:
    tools_json = json.loads(tools_data)
tools_conn.close()
tools_list = tools_json.get("result", {}).get("tools", [])
tool_names = {tool.get("name") for tool in tools_list}
for required in {"profile", "list_devices", "read_file", "write_file", "run_command"}:
    assert required in tool_names, (required, tool_names)
for tool in tools_list:
    assert tool.get("securitySchemes"), tool
    assert tool.get("annotations") is not None, tool

profile_descriptor = next(tool for tool in tools_list if tool.get("name") == "profile")
assert profile_descriptor.get("_meta", {}).get("openai/profile") is True, profile_descriptor
profile_schema = profile_descriptor.get("outputSchema", {})
assert profile_schema.get("required") == ["id"], profile_schema
assert profile_schema.get("additionalProperties") is False, profile_schema

profile_conn = http.client.HTTPConnection("127.0.0.1", MCP_PORT, timeout=5)
profile_conn.request(
    "POST",
    "/mcp",
    body=json.dumps({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "profile", "arguments": {}},
    }),
    headers=tools_headers,
)
profile_res = profile_conn.getresponse()
profile_data = profile_res.read()
assert profile_res.status == 200, (profile_res.status, profile_data[:500])
profile_content_type = profile_res.getheader("Content-Type", "")
if profile_content_type.startswith("text/event-stream"):
    profile_lines = [
        line[5:].strip()
        for line in profile_data.decode().splitlines()
        if line.startswith("data:")
    ]
    assert profile_lines, profile_data[:500]
    profile_json = json.loads(profile_lines[-1])
else:
    profile_json = json.loads(profile_data)
profile_conn.close()
profile_result = profile_json.get("result", {})
profile_structured = profile_result.get("structuredContent", {})
assert isinstance(profile_structured.get("id"), str) and profile_structured["id"].strip(), profile_result

print(json.dumps({
    "dcr": True,
    "pkce": True,
    "refresh_token": True,
    "resource_audience": claims["aud"],
    "scope": scope,
    "id_token": {
        "sub_present": bool(id_claims.get("sub")),
        "email_matches": id_claims["email"] == email,
    },
    "profile": {
        "schema": True,
        "structured_id": True,
    },
    "mcp_initialize": True,
}, indent=2))
