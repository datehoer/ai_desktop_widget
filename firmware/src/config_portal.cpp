#include "config_portal.h"

#include <DNSServer.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>

namespace {
constexpr char kSetupPassword[] = "codexsetup";
constexpr char kLanHostname[] = "codex-widget";
constexpr uint16_t kDnsPort = 53;
WebServer lanWebServer(80);
bool restartPending = false;
unsigned long restartAt = 0;

String htmlEscape(const String &input) {
  String output;
  output.reserve(input.length() + 16);
  for (size_t index = 0; index < input.length(); index++) {
    switch (input[index]) {
      case '&': output += F("&amp;"); break;
      case '<': output += F("&lt;"); break;
      case '>': output += F("&gt;"); break;
      case '"': output += F("&quot;"); break;
      case '\'': output += F("&#39;"); break;
      default: output += input[index]; break;
    }
  }
  return output;
}

String setupAccessPointName() {
  const uint64_t chipId = ESP.getEfuseMac();
  char suffix[5];
  snprintf(suffix, sizeof(suffix), "%04X", static_cast<uint16_t>(chipId & 0xFFFF));
  return "Codex-Widget-" + String(suffix);
}

String timezoneOption(const char *id, const char *label, const String &selectedId) {
  String option = "<option value=\"" + String(id) + "\"";
  if (selectedId == id) option += " selected";
  option += ">" + String(label) + "</option>";
  return option;
}

String timezoneOptions(const String &selectedId) {
  String options;
  options.reserve(1200);
  options += timezoneOption("Asia/Shanghai", "中国标准时间 · 上海（UTC+8）", selectedId);
  options += timezoneOption("Asia/Singapore", "新加坡（UTC+8）", selectedId);
  options += timezoneOption("Asia/Tokyo", "日本 · 东京（UTC+9）", selectedId);
  options += timezoneOption("Asia/Kolkata", "印度 · 加尔各答（UTC+5:30）", selectedId);
  options += timezoneOption("Asia/Dubai", "阿联酋 · 迪拜（UTC+4）", selectedId);
  options += timezoneOption("Europe/London", "英国 · 伦敦", selectedId);
  options += timezoneOption("Europe/Berlin", "欧洲中部 · 柏林", selectedId);
  options += timezoneOption("America/New_York", "美国东部 · 纽约", selectedId);
  options += timezoneOption("America/Chicago", "美国中部 · 芝加哥", selectedId);
  options += timezoneOption("America/Denver", "美国山区 · 丹佛", selectedId);
  options += timezoneOption("America/Los_Angeles", "美国西部 · 洛杉矶", selectedId);
  options += timezoneOption("Australia/Sydney", "澳大利亚 · 悉尼", selectedId);
  options += timezoneOption("Pacific/Auckland", "新西兰 · 奥克兰", selectedId);
  options += timezoneOption("Etc/UTC", "协调世界时（UTC）", selectedId);
  return options;
}

void drawSetupScreen(TFT_eSPI &tft, const String &ssid, const String &reason) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString("SETUP MODE", 120, 24, 4);
  tft.setTextColor(0x8C71, TFT_BLACK);
  tft.drawString(reason, 120, 63, 2);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString(ssid, 120, 94, 2);
  tft.setTextColor(0x8C71, TFT_BLACK);
  tft.drawString("Password", 120, 121, 2);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString(kSetupPassword, 120, 142, 2);
  tft.setTextColor(0x3F67, TFT_BLACK);
  tft.drawString("192.168.4.1", 120, 178, 4);
  tft.setTextColor(0x8C71, TFT_BLACK);
  tft.drawString("Open in browser", 120, 214, 2);
  tft.setTextDatum(TL_DATUM);
}

String buildSetupPage(const WidgetConfig &config) {
  String networkOptions;
  const int networkCount = WiFi.scanNetworks();
  for (int index = 0; index < networkCount; index++) {
    const String ssid = WiFi.SSID(index);
    networkOptions += F("<option value=\"");
    networkOptions += htmlEscape(ssid);
    networkOptions += F("\">");
    networkOptions += String(WiFi.RSSI(index));
    networkOptions += F(" dBm</option>");
  }
  WiFi.scanDelete();

  String page;
  page.reserve(7000 + networkOptions.length());
  page += F(R"HTML(<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codex Widget Setup</title><style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;background:#090b10;color:#f5f7fa}.wrap{max-width:560px;margin:auto;padding:28px 20px 48px}
h1{font-size:28px;margin:0 0 8px}.sub{color:#9299a6;margin:0 0 28px}.card{background:#151922;border:1px solid #272d3a;border-radius:18px;padding:20px}
label{display:block;font-size:13px;color:#aeb5c2;margin:17px 0 7px}input,select{box-sizing:border-box;width:100%;border:1px solid #353d4d;border-radius:11px;background:#0d1016;color:#fff;padding:12px;font-size:16px}
.hint{font-size:12px;color:#7f8795;margin-top:6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.check{display:flex;gap:9px;align-items:center;color:#aeb5c2;font-size:13px;margin-top:12px}.check input{width:auto}
button{width:100%;border:0;border-radius:12px;background:#36d17c;color:#07130c;font-weight:700;font-size:16px;padding:14px;margin-top:24px}.foot{text-align:center;color:#69717f;font-size:12px;margin-top:18px}
@media(max-width:480px){.row{grid-template-columns:1fr}}
</style></head><body><main class="wrap"><h1>Codex Widget</h1><p class="sub">配置网络和本地数据桥</p><form class="card" method="post" action="/save">
<label>Wi-Fi 名称</label><input name="ssid" list="networks" required maxlength="64" value=")HTML");
  page += htmlEscape(config.wifiSsid);
  page += F(R"HTML("><datalist id="networks">)HTML");
  page += networkOptions;
  page += F(R"HTML(</datalist><label>Wi-Fi 密码</label><input name="password" type="password" maxlength="64" autocomplete="new-password"><div class="hint">同一 Wi-Fi 留空会保留原密码；新网络留空表示开放网络。</div>
<label>Codex Bridge URL</label><input name="bridge" type="url" required maxlength="180" value=")HTML");
  page += htmlEscape(config.bridgeUrl);
  page += F(R"HTML(" placeholder="http://192.168.1.100:8787/api/status"><div class="hint">填写 Mac 的局域网地址，不能使用 localhost。</div>
<div class="row"><div><label>时区</label><select name="timezone" required>)HTML");
  page += timezoneOptions(config.timezoneId);
  page += F(R"HTML(</select></div><div><label>刷新间隔（秒）</label><input name="poll" type="number" min="2" max="60" value=")HTML");
  page += String(config.pollIntervalSeconds);
  page += F(R"HTML("></div></div><button type="submit">保存并重启</button></form><p class="foot">密码保存在设备 NVS；Codex 登录凭证始终留在 Mac。</p></main></body></html>)HTML");
  return page;
}

void registerConfigRoutes(WebServer &webServer, WidgetConfig &workingConfig,
                          const String &redirectUrl, bool captivePortal) {
  WebServer *server = &webServer;
  WidgetConfig *config = &workingConfig;

  auto redirectToRoot = [server, redirectUrl]() {
    server->sendHeader("Location", redirectUrl, true);
    server->send(302, "text/plain", "");
  };

  server->on("/", HTTP_GET, [server, config]() {
    server->send(200, "text/html; charset=utf-8", buildSetupPage(*config));
  });

  if (captivePortal) {
    server->on("/generate_204", HTTP_GET, redirectToRoot);
    server->on("/hotspot-detect.html", HTTP_GET, redirectToRoot);
    server->on("/ncsi.txt", HTTP_GET, redirectToRoot);
    server->on("/connecttest.txt", HTTP_GET, redirectToRoot);
  }

  server->on("/save", HTTP_POST, [server, config]() {
    WidgetConfig next = *config;
    next.wifiSsid = server->arg("ssid");
    next.wifiSsid.trim();
    const String submittedPassword = server->arg("password");
    if (next.wifiSsid != config->wifiSsid || submittedPassword.length() > 0) {
      next.wifiPassword = submittedPassword;
    }

    next.bridgeUrl = server->arg("bridge");
    next.bridgeUrl.trim();
    next.timezoneId = server->arg("timezone");
    next.pollIntervalSeconds = constrain(server->arg("poll").toInt(), 2L, 60L);

    if (!hasCompleteWidgetConfig(next)) {
      server->send(400, "text/html; charset=utf-8",
                   "<meta charset=utf-8><h2>配置无效</h2><p>请检查 Wi-Fi、Bridge URL、时区和刷新间隔。</p><a href='/'>返回</a>");
      return;
    }
    if (!saveWidgetConfig(next)) {
      server->send(500, "text/html; charset=utf-8",
                   "<meta charset=utf-8><h2>保存失败</h2><p>NVS 写入失败，请重试。</p><a href='/'>返回</a>");
      return;
    }

    *config = next;
    server->send(200, "text/html; charset=utf-8",
                 "<meta charset=utf-8><meta name=viewport content='width=device-width'><style>body{font-family:sans-serif;background:#090b10;color:white;padding:30px}</style><h2>保存成功</h2><p>设备正在重启并连接 Wi-Fi，可以关闭此页面。</p>");
    restartPending = true;
    restartAt = millis() + 1200;
  });

  if (captivePortal) {
    server->onNotFound(redirectToRoot);
  } else {
    server->onNotFound([server]() {
      server->send(404, "text/plain; charset=utf-8", "Not found");
    });
  }
}

void restartWhenReady() {
  if (restartPending && static_cast<long>(millis() - restartAt) >= 0) ESP.restart();
}
}  // namespace

bool startLanConfigServer(WidgetConfig &currentConfig) {
  if (WiFi.status() != WL_CONNECTED) return false;

  const bool mdnsReady = MDNS.begin(kLanHostname);
  if (mdnsReady) MDNS.addService("http", "tcp", 80);

  registerConfigRoutes(lanWebServer, currentConfig, "/", false);
  lanWebServer.begin();

  Serial.printf("[config] LAN page: http://%s/\n", WiFi.localIP().toString().c_str());
  if (mdnsReady) Serial.printf("[config] LAN page: http://%s.local/\n", kLanHostname);
  return true;
}

void handleLanConfigServer() {
  lanWebServer.handleClient();
  restartWhenReady();
}

[[noreturn]] void runConfigPortal(TFT_eSPI &tft, const WidgetConfig &currentConfig,
                                  const String &reason) {
  WidgetConfig workingConfig = currentConfig;
  const String accessPointName = setupAccessPointName();

  WiFi.disconnect(true);
  delay(150);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(accessPointName.c_str(), kSetupPassword);

  const IPAddress portalIp = WiFi.softAPIP();
  drawSetupScreen(tft, accessPointName, reason);
  Serial.printf("[setup] AP: %s\n", accessPointName.c_str());
  Serial.printf("[setup] password: %s\n", kSetupPassword);
  Serial.printf("[setup] open http://%s/\n", portalIp.toString().c_str());

  DNSServer dnsServer;
  WebServer webServer(80);

  dnsServer.start(kDnsPort, "*", portalIp);
  registerConfigRoutes(webServer, workingConfig, "http://" + portalIp.toString() + "/", true);
  webServer.begin();

  while (true) {
    dnsServer.processNextRequest();
    webServer.handleClient();
    restartWhenReady();
    delay(2);
  }
}
