/**
 * NMPA（国家药监局）医疗器械注册数据爬取代理
 * ==========================================
 * 服务端绕过瑞数 WAF 的真实数据爬取，等价于 123.py 的 query 流程：
 *   1. 首次请求 NMPA search 接口（带签名 headers），若返回 412 挑战页
 *   2. 解析挑战页：meta id/content、第一个 script 文本(tscode)、
 *      第二个 script src 引用的远端 JS(wlcode)
 *   3. 替换进内嵌 rscookie_all.js 模板，用 Node vm/v8 natives 执行生成瑞数 cookie
 *   4. 带 cookie 重试请求，成功返回 NMPA 原始 JSON
 *
 * 签名算法（与 123.py make_sign 等价）：
 *   s = 非空参数按 key 排序拼成 key=value&...
 *   s = s + '&nmpasecret2020'
 *   s = encodeURIComponent(s) 且 !→%21、(→%28、)→%29、~→%7E
 *   sign = md5(s)
 *
 * 部署：
 *   - Vercel serverless: GET /api/nmpa?year=2025&page=1&size=20
 *   - 本地运行: node api/nmpa.js  → http://localhost:3000/api/nmpa?year=2025
 */

const crypto = require('crypto');
const cheerio = require('cheerio');

const BASE = 'https://www.nmpa.gov.cn';
const API = BASE + '/datasearch/data/nmpadata/search';
const REFERER = BASE + '/datasearch/home-index.html';
const APP_SECRET = 'nmpasecret2020';
const ITEM_ID = 'ff80808183cad7500183cb66fe690285'; // 境内医疗器械（注册）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const MAX_RETRIES = 3;

// ==================== 瑞数 cookie 生成模板（内嵌 rscookie_all.js） ====================
const RS_TEMPLATE = `content = "{content}";
delete __dirname
delete __filename
ActiveXObject = undefined
//content = "content_data"
function get_enviroment(proxy_array) {
    for (var i = 0; i < proxy_array.length; i++) {
        handler = '{\\n' +
            '    get: function(target, property, receiver) {\\n' +
            '        console.log("方法:", "get  ", "对象:", ' +
            '"' + proxy_array[i] + '" ,' +
            '"  属性:", property, ' +
            '"  属性类型:", ' + 'typeof property, ' +
            // '"  属性值:", ' + 'target[property], ' +
            '"  属性值类型:", typeof target[property]);\\n' +
            '        return target[property];\\n' +
            '    },\\n' +
            '    set: function(target, property, value, receiver) {\\n' +
            '        console.log("方法:", "set  ", "对象:", ' +
            '"' + proxy_array[i] + '" ,' +
            '"  属性:", property, ' +
            '"  属性类型:", ' + 'typeof property, ' +
            // '"  属性值:", ' + 'target[property], ' +
            '"  属性值类型:", typeof target[property]);\\n' +
            '        return Reflect.set(...arguments);\\n' +
            '    }\\n' +
            '}'
        eval('try{\\n' + proxy_array[i] + ';\\n'
            + proxy_array[i] + '=new Proxy(' + proxy_array[i] + ', ' + handler + ')}catch (e) {\\n' + proxy_array[i] + '={};\\n'
            + proxy_array[i] + '=new Proxy(' + proxy_array[i] + ', ' + handler + ')}')
    }
}
proxy_array = ['window', 'document', 'location', 'navigator', 'history', 'screen', 'aaa', 'target', 'documentElement', 'script', 'all', 'body', 'Document']

const v8 = require('v8');
const vm=require('vm');
v8.setFlagsFromString('--allow-natives-syntax');
let undetectable = vm.runInThisContext("%GetUndetectable()");
v8.setFlagsFromString('--no-allow-natives-syntax');

!(function () {
    "use strict";
    const $toString = Function.toString;
    const myFunction_toString_symbol = Symbol('('.concat('', ')_', (Math.random() + '').toString(36)));
    const mytoString = function () {
        return typeof this == 'function' && this[myFunction_toString_symbol] || $toString.call(this);
    };

    function set_native(func, key, value) {
        Object.defineProperty(func, key, {
            "enumerable": false,
            "configurable": true,
            "writable": true,
            "value": value
        })
    };
    delete Function.prototype['toString'];
    set_native(Function.prototype, "toString", mytoString);
    set_native(Function.prototype.toString, myFunction_toString_symbol, "function toString() { [native code] }");
    this.func_set_native = function (func) {
        set_native(func, myFunction_toString_symbol, \`function \${myFunction_toString_symbol, func.name || ''}() { [native code] }\`)
    }
}).call(globalThis);
// 重写全局对象原型链
function setTostringAndstringTag(obj, dictValue) {
    Object.defineProperties(obj.prototype, {
        [Symbol.toStringTag]: {
            configurable: true,
            value: obj.name
        }
    });
    globalThis.func_set_native(obj);
};
// 创建标签原型
function createTagProto(propObj,portotypeObj) {
    let res = propObj + ' = ' + 'function ' + propObj + '() { throw new TypeError("Illegal constructor"); };\\n';
    res += 'setTostringAndstringTag(' + propObj + ',null);\\n';
    if (portotypeObj) {
        for (let key in portotypeObj) {
            res += propObj + '.prototype.' + portotypeObj[key] + '= function ' + portotypeObj[key] + '() {};\\n';
            res += 'globalThis.func_set_native(' + propObj + '.prototype.' + portotypeObj[key] + ');\\n';
        }
    }
    eval(res);
}

createTagProto('HTMLAllCollection');
all = undetectable;
all.__proto__ = HTMLAllCollection.prototype;
all.length = 2747;

window = global;
window.top = window;
window.fetch = function (res) {
    console.log('window中的fetch接受的值:', res)
}
window.sessionStorage = function (res) {
    console.log('window中的fetch接受的值:', res)
}
window.addEventListener = function (res) {
    console.log('window中的addEventListener接受的值:', res)
}
window.DOMParser = function (res) {
    console.log('window中的DOMParser接受的值:', res)
}
window.localStorage = {}
window.name = '$_YWTU=J5Kqj1vMVZt0p3jcKdQszRtzTokjPjsSc6r8XesJXBg&$_cDro=49&vdFm='
window.self = window

var elemA = {
    _href: '',
    set href(x) {
        console.log('set a href: ', x)
        if (!x.startsWith('http')) {
            if (x.startsWith('./')) {
                this._href = this.origin + '/' + x.replace('./', '')
            } else {
                this._href = this.origin + x
            }

        } else {
            this._href = x.replace(':443', '').replace(':80', '')
        }
    },
    get href() {
        console.log('get a href: ', this._href)
        return this._href
    },
    hostname: '',
    hash: '',
    origin: '',
    protocol: '',
    pathname: "",
    port: '',
    search: '',
    url: '',
}

window.XMLHttpRequest = function () {
}
XMLHttpRequest = function () {
};
XMLHttpRequest.prototype.open = function () {
};
XMLHttpRequest.prototype.send = function () {
};
XMLHttpRequest.prototype.setRequestHeader = function () {
};
// document 环境
div = {
    getElementsByTagName: function (res) {
        console.log('div中的getElementsByTagName接受的值:', res)
        if (res == 'i') {
            return {length: 0}
        }
    },
	innerHTML: "123",
	hostname: "",
	port: "",
	pathname: "/",
	protocol: "http:",
	search: "",
	hash: "",
	
}
meta = {
    0: {
        "http-equiv": "Content-Type",
        content: "text/html",
        charset: "utf-8",
        getAttribute: function (res) {
            console.log('meta0中的getAttribute接受的值:', res)
            if (res == 'r') {
                return 'm'
            }
        },
	},
    1: {
        content: content,
        parentNode: {
            removeChild: function (res) {
                console.log('meta1中的parentNode接受的值:', res)
            }
        },
		getAttribute: function (res) {
            console.log('meta1中的getAttribute接受的值:', res)
            if (res == 'r') {
                return 'm'
            }
        },
    },
    length: 2
}
script = {
    0: {
        getAttribute: function (res) {
            console.log('script0中的getAttribute接受的值:', res)
            if (res == 'r') {
                return 'm'
            }
        },
        parentElement: {
            removeChild: function (res) {
                console.log('script0中的removeChild接受的值:', res)
            }
        }
    },
    length: 1,
	getAttribute: function (res) {
		console.log('script0中的getAttribute接受的值:', res)
		if (res == 'r') {
			return 'm'
		}
	},
	parentElement: {
		removeChild: function (res) {
			console.log('script0中的removeChild接受的值:', res)
		}
	},
	innerText: '123123'
}
base = {length: 0}
input = {
	toString: function(){
		return '[object HTMLInputElement]'
	}
}
form = {
    id: "__Zm9ybS5pZAo__",
    action: "https://ucenter.miit.gov.cn/login.jsp",
	appendChild: function (res) {
        console.log('form中的appendChild接受的值:', res)
		
    }
}
documentElement = {}

body = {}
document = {
    all: {},
	documentElement: documentElement,
	visibilityState: 'visible',
    characterSet: 'UTF-8',
    charset: 'UTF-8',
	body: body,
    createElement: function (res) {
        console.log('document中的createElement接受的值:', arguments)
        if (res === 'div') {
            return div
        }
        if (res === 'form') {
            return form
        }
		if (res == 'a'){
			return elemA
		}
		if (res == 'input'){
			return null
		}
        return div
    },
    getElementsByTagName: function (res) {
        console.log('document中的getElementsByTagName接受的值:', res)
        if (res == 'meta') {
            return meta
        }
        if (res == 'script') {
            return [script]
        }
        if (res == 'i') {
            return {length: 0}
        }
		if (res === 'base') {
            return base
        }
        return div
    },
    addEventListener: function (res) {
        console.log('document中的addEventListener接受的值:', res)
    },
	getElementById: function (res) {
        console.log('document中的getElementById：', arguments)
        if (res === 'root-hammerhead-shadow-ui') {
            return null
        }
		if (res == '{rsid}') {
            return meta[1]
        }
        return {}
    },
    appendChild: function (res) {
        console.log('document中的appendChild接受的值:', res)
		return div
    },
	removeChild: function (res) {
        console.log('document中的removeChild接受的值:', res)
    },
}


location = {
    "ancestorOrigins": {},
    "href": "https://www.nmpa.gov.cn/datasearch/home-index.html",
    "origin": "https://www.nmpa.gov.cn",
    "protocol": "https:",
    "host": "www.nmpa.gov.cn",
    "hostname": "www.nmpa.gov.cn",
    "port": "",
    "pathname": "/datasearch/home-index.html",
    "search": "",
    "hash": ""
}
history = {
    replaceState: function(res){
        console.log('history中的replaceState接受的值:', arguments)
    }
}
navigator = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36",
    languages: ["zh-CN", "zh"],
    appVersion: "5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
    webdriver: false,
    appName: "Netscape",
    vendor: "Google Inc.",
    connection: {
        downlink: 10,
        effectiveType: "4g",
        rtt: 50,
        saveData: false,
    },
    platform: "Win32",
    //battery: undefined,
    getBattery: function(res){
        console.log('navigator中的getBattery接受的值:', res)
		return {}
    },
    webkitPersistentStorage: {},
    mimeTypes: {}
};
window.clientInformation = navigator;
window.PointerEvent = function(res){console.log("window中的PointerEvent接受的值:",res)};
window.webkitRequestFileSystem = function(res){console.log("window中的webkitRequestFileSystem接受的值:",res)};
window.chrome = {
    "app": {
        "isInstalled": false,
        "InstallState": {
            "DISABLED": "disabled",
            "INSTALLED": "installed",
            "NOT_INSTALLED": "not_installed"
        },
        "RunningState": {
            "CANNOT_RUN": "cannot_run",
            "READY_TO_RUN": "ready_to_run",
            "RUNNING": "running"
        }
    }
}
window.open = function(res){console.log("window中的open接受的值:",res)};
window.TEMPORARY = 0;
window.CanvasRenderingContext2D = function(res){
	console.log("window.CanvasRenderingContext2D", res)
}
window.HTMLCanvasElement = function(res){
	console.log("window.HTMLCanvasElement", res)
}
window.HTMLCanvasElement = function(res){
	console.log("window.MutationObserver", res)
}
window.WebSocket = function(res){
	console.log("window.MutationObserver", res)
}

window.innerHeight = 1392
window.innerWidth = 2560
window.outerHeight = 1392
window.outerWidth = 2560

get_enviroment(proxy_array)
setTimeout = function () {
}
setInterval = function () {
}
HTMLAnchorElement = function (){}
HTMLFormElement = function (){}
;;
{tscode}


{wlcode}

function getUrl(url, method = 'POST') {
    var urlObj = new URL(url);
    elemA.pathname = urlObj.pathname;
    elemA.search = urlObj.search;
    elemA.protocol = urlObj.protocol;
    elemA.origin = urlObj.origin;
    elemA.hostname = urlObj.hostname;
	console.log(11111111111,elemA)
    var res = XMLHttpRequest.prototype.open(method, url, false)
    return res
}


function getcookie(){
	return document.cookie;
	//return cook;
}
//onsole.log(document.cookie);
console.log("document.cookie", getcookie());
`;

// ==================== 签名 ====================
function makeSign(params) {
  const parts = Object.keys(params)
    .filter(k => params[k] !== '' && params[k] != null)
    .map(k => `${k}=${params[k]}`)
    .sort();
  let s = parts.join('&') + '&' + APP_SECRET;
  // encodeURIComponent 等价（保留 - _ . ~ ' *）后再手动替换 !()~
  let encoded = encodeURIComponent(s);
  encoded = encoded.replace(/!/g, '%21').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/~/g, '%7E');
  return crypto.createHash('md5').update(encoded, 'utf8').digest('hex');
}

// ==================== 瑞数 cookie 生成 ====================
function fillTemplate(template, { rsid, content, tscode, wlcode }) {
  return template
    .split('{rsid}').join(rsid)
    .split('{content}').join(JSON.stringify(content).slice(1, -1))
    .split('{tscode}').join(tscode)
    .split('{wlcode}').join(wlcode);
}

function generateRsCookie(rsid, metaContent, tscode, wlcode) {
  const filled = fillTemplate(RS_TEMPLATE, {
    rsid,
    content: metaContent,
    tscode,
    wlcode,
  });
  // 模板执行会通过 `window = global` 等语句污染全局（fetch/XMLHttpRequest/
  // setTimeout/setInterval/WebSocket/name 等），必须快照并在执行后恢复
  const backup = snapshotGlobals();
  // 静音模板内的 console.log（模板会打印大量环境探针日志）
  const originalLog = console.log;
  console.log = function () {};
  try {
    const factory = new Function('require', 'module', 'exports', '__dirname', '__filename', filled + '\n; return getcookie();');
    const cookieStr = factory(require, module, exports, __dirname, __filename);
    return cookieStr || '';
  } finally {
    console.log = originalLog;
    restoreGlobals(backup);
  }
}

function snapshotGlobals() {
  const keys = Object.getOwnPropertyNames(globalThis);
  const snapshot = {};
  for (const k of keys) snapshot[k] = globalThis[k];
  return { snapshot, keys };
}

function restoreGlobals(backup) {
  const { snapshot, keys } = backup;
  const currentKeys = Object.getOwnPropertyNames(globalThis);
  // 删除模板新增的全局属性
  for (const k of currentKeys) {
    if (!(k in snapshot)) {
      try { delete globalThis[k]; } catch (e) {}
    }
  }
  // 恢复被模板修改的全局属性
  for (const k of keys) {
    if (globalThis[k] !== snapshot[k]) {
      try { globalThis[k] = snapshot[k]; } catch (e) {}
    }
  }
}

function parseCookiePairs(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  String(cookieStr).split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name) cookies[name] = value;
    }
  });
  return cookies;
}

// ==================== 挑战页解析 ====================
function parseChallengeHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  let rsid = '';
  let metaContent = '';
  $('meta').each(function () {
    const id = $(this).attr('id');
    if (id) {
      rsid = id;
      metaContent = $(this).attr('content') || '';
    }
  });
  const scripts = $('script');
  const tscode = scripts.eq(0).html() || '';
  const src = scripts.eq(1).attr('src') || '';
  const scriptUrl = src ? new URL(src, baseUrl).href : '';
  return { rsid, metaContent, tscode, scriptUrl };
}

// ==================== HTTP 请求 ====================
function buildHeaders(params) {
  const ts = String(Date.now());
  const sign = makeSign({ ...params, timestamp: ts });
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': REFERER,
    'timestamp': ts,
    'sign': sign,
    'token': 'false',
  };
}

async function httpGet(url, headers, cookieMap, timeoutMs = 30000) {
  const h = { ...headers };
  if (cookieMap && Object.keys(cookieMap).length) {
    h['Cookie'] = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const resp = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  return resp;
}

/**
 * 等价于 123.py 的 query()：查 NMPA 数据接口，自动处理瑞数 412 挑战。
 * @returns {Promise<object>} NMPA 原始 JSON
 */
async function queryNmpa(keyword, page = 1, size = 20) {
  const params = {
    itemId: ITEM_ID,
    isSenior: 'N',
    searchValue: keyword,
    orderParam: '',
    pageNum: page,
    pageSize: size,
  };
  const qs = new URLSearchParams(params).toString();
  const url = API + '?' + qs;

  let sessionCookies = {};
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const headers = buildHeaders(params);
    const resp = await httpGet(url, headers, sessionCookies);

    if (resp.status === 200) {
      const text = await resp.text();
      // JSON 数据直接返回
      if (text.trimStart().startsWith('{')) {
        try {
          return JSON.parse(text);
        } catch (e) {
          lastError = new Error('JSON 解析失败');
          continue;
        }
      }
      // 200 但 HTML → 可能也是挑战页（瑞数有时返回 200 挑战）
      const parsed = parseChallengeHtml(text, resp.url || REFERER);
      if (parsed.rsid) {
        let cookieStr = '';
        try {
          const wlcode = parsed.scriptUrl ? await (await fetch(parsed.scriptUrl, {
            headers: { 'User-Agent': UA, 'Referer': REFERER, 'Accept': '*/*' },
            signal: AbortSignal.timeout(15000),
          })).text() : '';
          cookieStr = generateRsCookie(parsed.rsid, parsed.metaContent, parsed.tscode, wlcode);
        } catch (e) {
          lastError = new Error(`瑞数cookie生成失败: ${e.message}`);
          console.error('[nmpa] generateRsCookie error:', e);
          continue;
        }
        sessionCookies = { ...sessionCookies, ...parseCookiePairs(cookieStr) };
        if (!cookieStr) {
          lastError = new Error('瑞数cookie生成为空');
          continue;
        }
        continue;
      }
      lastError = new Error('未知 200 响应（非 JSON 也非挑战页）');
      continue;
    }

    if (resp.status === 412) {
      const html = await resp.text();
      const parsed = parseChallengeHtml(html, resp.url || REFERER);
      let cookieStr = '';
      try {
        const wlcode = parsed.scriptUrl ? await (await fetch(parsed.scriptUrl, {
          headers: { 'User-Agent': UA, 'Referer': REFERER, 'Accept': '*/*' },
          signal: AbortSignal.timeout(15000),
        })).text() : '';
        cookieStr = generateRsCookie(parsed.rsid, parsed.metaContent, parsed.tscode, wlcode);
      } catch (e) {
        lastError = new Error(`瑞数cookie生成失败: ${e.message}`);
        console.error('[nmpa] generateRsCookie error:', e);
        continue;
      }
      sessionCookies = { ...sessionCookies, ...parseCookiePairs(cookieStr) };
      console.log(`[nmpa] 瑞数 cookie 已生成（第 ${attempt + 1} 次），重试...`);
      continue;
    }

    lastError = new Error(`请求失败 status=${resp.status} body=${textPreview(await resp.text())}`);
    break;
  }

  throw lastError || new Error('瑞数 cookie 多次失效，请稍后重试');
}

function textPreview(s) {
  return String(s || '').replace(/\s+/g, ' ').slice(0, 200);
}

// ==================== Vercel Serverless Handler ====================
async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const year = String(req.query.year || '2025').replace(/[^\d]/g, '') || '2025';
  const page = Math.max(1, Math.min(parseInt(req.query.page, 10) || 1, 100));
  const size = Math.max(1, Math.min(parseInt(req.query.size, 10) || 20, 50));

  try {
    const data = await queryNmpa(`械注准${year}`, page, size);
    return res.status(200).json({ code: 200, data, source: 'nmpa-proxy', year });
  } catch (err) {
    console.error('[nmpa] proxy error:', err.message);
    return res.status(502).json({ code: 500, data: null, message: err.message, source: 'nmpa-proxy' });
  }
}

// Vercel 导出
module.exports = handleRequest;

// ==================== 本地运行 ====================
if (require.main === module) {
  const http = require('http');
  const PORT = process.env.PORT || 3000;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/nmpa')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 404, message: 'Not Found' }));
    }
    // 把 URL query 转成 req.query 形态再复用同一处理逻辑
    const fakeReq = { method: req.method, query: Object.fromEntries(u.searchParams.entries()) };
    const fakeRes = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(obj) {
        res.writeHead(this.statusCode, { ...this.headers, 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(obj));
      },
      end() { if (!res.writableEnded) res.end(); },
    };
    await handleRequest(fakeReq, fakeRes);
  });

  server.listen(PORT, () => {
    console.log(`NMPA proxy running: http://localhost:${PORT}/api/nmpa?year=2025&page=1&size=20`);
  });
}
