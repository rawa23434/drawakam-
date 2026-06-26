const express = require('express');
const path = require('path');
const https = require('https');
const WebSocket = require('ws');
const app = express();
const PORT = process.env.PORT || 3001;

const cookieParser = require('cookie-parser');

app.use(express.json());
app.use(cookieParser());

// لۆگین API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'qazanj bka') {
        res.cookie('auth_token', 'logged_in_secret_key', { httpOnly: true }); // تەنها بۆ یەک سێشن دەمێنێتەوە
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, message: 'یوزەرنەیم یان پاسوۆرد هەڵەیە' });
});

// سیستمی پاراستنی فایلەکان
app.use((req, res, next) => {
    // ئەگەر دەچێتە سەر پەڕەی لۆگین، ڕێگەی پێ بدە
    if (req.path === '/login.html' || req.path.startsWith('/api/') || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.includes('font') || req.path.includes('logo')) {
        return next();
    }

    // ئەگەر کۆکی نەبوو، بینێرە بۆ پەڕەی لۆگین
    if (req.cookies.auth_token !== 'logged_in_secret_key') {
        return res.redirect('/login.html');
    }

    // ئەگەر کێشەی نەبوو با بڕواتە ناو ماڵپەڕەکە
    next();
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// دروستکردنی سێرڤەری WebSocket لەسەر هەمان پۆرتی Express
const server = app.listen(PORT, () => console.log(`🚀 Prototype live at http://localhost:${PORT}`));
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let binanceSocket = null;

    ws.on('message', (message) => {
        try {
            const { type, symbol } = JSON.parse(message);
            if (type === 'SUBSCRIBE') {
                // ئەگەر پێشتر پەیوەندییەک هەبوو، دایبخە
                if (binanceSocket) binanceSocket.close();

                const bSymbol = symbol.toLowerCase();
                binanceSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${bSymbol}@kline_1h`);

                binanceSocket.on('message', (data) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(data.toString());
                    }
                });
            }
        } catch (e) { console.error("WS Error:", e); }
    });

    ws.on('close', () => { if (binanceSocket) binanceSocket.close(); });
});

// API Proxy بۆ هێنانی داتا لە Binance بۆ دوورکەوتنەوە لە CORS
app.get('/api/candles', (req, res) => {
    const { symbol, interval } = req.query;
    console.log(`[Binance Candles] Request: symbol=${symbol}, interval=${interval}`);
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol || 'BTCUSDT'}&interval=${interval || '1h'}&limit=500`;

    https.get(binanceUrl, (apiRes) => {
        let rawData = '';
        apiRes.on('data', (chunk) => rawData += chunk);
        apiRes.on('end', () => {
            try {
                res.json(JSON.parse(rawData));
            } catch (e) {
                res.status(500).json({ error: "هەڵە لە وەرگرتنی داتاکانی باینانس" });
            }
        });
    }).on('error', (err) => {
        res.status(500).json({ error: err.message });
    });
});

// Simple In-Memory Cache for GeckoTerminal responses
const memoryCache = {};

// Helper to fetch JSON from a URL with caching
function fetchWithCache(url, cacheDurationMs) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        if (memoryCache[url] && memoryCache[url].expiry > now) {
            console.log(`[Cache Hit] ${url}`);
            return resolve(memoryCache[url].data);
        }

        console.log(`[Cache Miss] Fetching: ${url}`);
        const options = {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        memoryCache[url] = {
                            data: parsed,
                            expiry: Date.now() + cacheDurationMs
                        };
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error(`JSON Parse Error: ${e.message}`));
                    }
                } else {
                    reject(new Error(`HTTP Error: ${res.statusCode} - ${res.statusMessage}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Helper to aggregate candle arrays (newest to oldest)
function aggregateCandles(ohlcvList, targetSeconds) {
    if (!ohlcvList || ohlcvList.length === 0) return [];

    // Sort oldest to newest for grouping
    const sorted = ohlcvList.slice().reverse();
    const aggregated = [];
    let currentPeriodStart = null;
    let currentCandle = null;

    for (const candle of sorted) {
        const timestamp = candle[0];
        const open = parseFloat(candle[1]);
        const high = parseFloat(candle[2]);
        const low = parseFloat(candle[3]);
        const close = parseFloat(candle[4]);
        const volume = parseFloat(candle[5]);

        // Find the period start for this timestamp
        const periodStart = Math.floor(timestamp / targetSeconds) * targetSeconds;

        if (currentPeriodStart === null || periodStart !== currentPeriodStart) {
            // Push previous candle if exists
            if (currentCandle) {
                aggregated.push(currentCandle);
            }
            // Start a new candle
            currentPeriodStart = periodStart;
            currentCandle = [
                periodStart, // timestamp
                open,        // open
                high,        // high
                low,         // low
                close,       // close
                volume       // volume
            ];
        } else {
            // Update current candle
            currentCandle[2] = Math.max(currentCandle[2], high); // high
            currentCandle[3] = Math.min(currentCandle[3], low);  // low
            currentCandle[4] = close;                            // close
            currentCandle[5] += volume;                          // volume
        }
    }

    // Push the last candle
    if (currentCandle) {
        aggregated.push(currentCandle);
    }

    // Reverse back to newest to oldest
    return aggregated.reverse();
}

// Helper to resolve token to pool address (cached for 24 hours)
async function resolvePool(network, tokenAddr) {
    const cacheKey = `pool-${network}-${tokenAddr}`;
    const now = Date.now();
    if (memoryCache[cacheKey] && memoryCache[cacheKey].expiry > now) {
        return memoryCache[cacheKey].poolAddress;
    }

    const tokenPoolsUrl = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddr}/pools?page=1`;
    try {
        const parsedPools = await fetchWithCache(tokenPoolsUrl, 24 * 3600 * 1000); // cache resolution for 24h
        if (parsedPools.data && parsedPools.data.length > 0) {
            const resolvedPool = parsedPools.data[0].attributes.address;
            memoryCache[cacheKey] = {
                poolAddress: resolvedPool,
                expiry: Date.now() + 24 * 3600 * 1000 // 24 hours
            };
            return resolvedPool;
        }
    } catch (err) {
        console.error(`[Gecko Candles] Error resolving pool for token ${tokenAddr}:`, err.message);
    }
    return null;
}

// Helper to fetch candles from GeckoTerminal API (cached for 60 seconds)
async function fetchCandlesRaw(network, poolAddr, type, aggregate) {
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddr}/ohlcv/${type}?aggregate=${aggregate}&limit=1000`;
    return fetchWithCache(url, 60 * 1000); // cache candles for 60 seconds
}

// API Proxy بۆ هێنانی داتای خاوی مۆمەکان لە GeckoTerminal بەبێ کێشەی CORS
app.get('/api/gecko-candles', async (req, res) => {
    const { network, pool, token, interval } = req.query;
    console.log(`[Gecko Candles] Request: network=${network}, pool=${pool}, token=${token}, interval=${interval}`);

    // گۆڕینی ناوی تۆڕەکان بۆ ئەوەی لەگەڵ GeckoTerminal بگونجێت
    const gtNetworks = {
        "ethereum": "eth",
        "bsc": "bsc",
        "polygon": "polygon_pos",
        "base": "base",
        "arbitrum": "arbitrum",
        "avalanche": "avax",
        "optimism": "optimism",
        "solana": "solana",
        "fantom": "fantom",
        "cronos": "cronos",
        "zksync": "zksync",
        "linea": "linea",
        "scroll": "scroll",
        "blast": "blast",
        "sui": "sui",
        "tron": "tron",
        "ton": "ton",
        "manta": "manta",
        "mantle": "mantle",
        "kava": "kava",
        "celo": "celo",
        "metis": "metis",
        "opbnb": "opbnb",
        "moonbeam": "moonbeam",
        "moonriver": "moonriver",
        "aurora": "aurora",
        "boba": "boba",
        "kcc": "kcc",
        "heco": "heco",
        "okc": "okc",
        "harmony": "harmony",
        "velas": "velas",
        "oasis": "oasis",
        "canto": "canto",
        "mode": "mode",
        "taiko": "taiko",
        "zora": "zora",
        "astar": "astar",
        "astar_zkevm": "astar_zkevm",
        "rootstock": "rsk",
        "syscoin": "syscoin",
        "conflux": "conflux",
        "core": "core",
        "klaytn": "klaytn",
        "wemix": "wemix",
        "step": "step",
        "dogechain": "dogechain",
        "elastos": "elastos",
        "meter": "meter",
        "telos": "telos",
        "milkomeda": "milkomeda",
        "aptos": "aptos",
        "osmosis": "osmosis",
        "ronin": "ronin",
        "beam": "beam",
        "shibarium": "shibarium",
        "xlayer": "xlayer",
        "zeta": "zetachain",
        "filecoin": "filecoin",
        "xdai": "xdai",
        "gnosis": "xdai",
        "polygon_zkevm": "polygon_zkevm",
        "evmos": "evmos",
        "coti": "coti",
        "starknet": "starknet",
        "sei": "sei",
        "injective": "injective",
        "neon": "neon",
        "kardiachain": "kardiachain",
        "theta": "theta",
        "thundercore": "thundercore",
        "smartbch": "smartbch",
        "fuse": "fuse",
        "sx": "sx",
        "tomochain": "tomochain",
        "wanchain": "wanchain",
        "iotex": "iotex",
        "bitgert": "bitgert",
        "kucoin": "kcc",
        "oasys": "oasys",
        "combo": "combo",
        "pzdc": "pzdc",
        "pulsechain": "pulsechain",
        "tenet": "tenet",
        "merlin": "merlin",
        "b2": "b2",
        "map": "map",
        "bevm": "bevm",
        "kroma": "kroma",
        "zkfair": "zkfair",
        "manta_pacific": "manta",
        "lightlink": "lightlink",
        "fon": "fon",
        "bouncebit": "bouncebit",
        "xai": "xai",
        "cyber": "cyber",
        "fraxtal": "fraxtal",
        "dydx": "dydx",
        "nibiru": "nibiru",
        "chiliz": "chiliz",
        "lisk": "lisk",
        "zeta_chain": "zetachain",
        "holesky": "holesky",
        "sepolia": "sepolia",
        "bsc_testnet": "bsc_testnet"
    };

    const gtNetwork = gtNetworks[network] || network;

    // دیاریکردنی جۆری کاتەکان
    const lower = (interval || '1h').toLowerCase();
    let type = 'hour';
    let aggregate = 1;
    let needsAggregation = false;
    let targetSeconds = 0;

    if (lower === '1m') { type = 'minute'; aggregate = 1; }
    else if (lower === '5m') { type = 'minute'; aggregate = 5; }
    else if (lower === '15m') { type = 'minute'; aggregate = 15; }
    else if (lower === '1h') { type = 'hour'; aggregate = 1; }
    else if (lower === '4h') { type = 'hour'; aggregate = 4; }
    else if (lower === '1d') { type = 'day'; aggregate = 1; }
    else if (lower === '1w') {
        // لەبەر ئەوەی ١ هەفتە بە شێوەیەکی خۆماڵی لەلایەن GeckoTerminal پالپشتی ناکرێت، داتای ڕۆژانە وەردەگرین و کۆمپیڵدەری دەکەین
        type = 'day';
        aggregate = 1;
        needsAggregation = true;
        targetSeconds = 7 * 24 * 3600;
    }

    // هێنانی داتا لە پولێکی دیاریکراو
    const performFetch = async (poolAddr) => {
        if (needsAggregation) {
            const raw = await fetchCandlesRaw(gtNetwork, poolAddr, type, aggregate);
            if (raw.data && raw.data.attributes && raw.data.attributes.ohlcv_list) {
                const aggregatedList = aggregateCandles(raw.data.attributes.ohlcv_list, targetSeconds);
                const result = JSON.parse(JSON.stringify(raw)); // کۆپیکردنی قووڵ بۆ دەستکاری
                result.data.attributes.ohlcv_list = aggregatedList;
                return result;
            }
            throw new Error("سیمبۆلی وەڵامدانەوە ناتەواوە بۆ کۆکردنەوە");
        } else {
            try {
                const raw = await fetchCandlesRaw(gtNetwork, poolAddr, type, aggregate);
                if (raw.data && raw.data.attributes && raw.data.attributes.ohlcv_list) {
                    return raw;
                }
                throw new Error("سیمبۆلی وەڵامدانەوە ناتەواوە");
            } catch (err) {
                // ئەگەر 4h سەرنەکەوت (بۆ نموونە بەهۆی کۆتایی لیمیت یان پاڵپشتی نەکردن)، کۆمپیڵدی دەکەین لە 1h مۆمەکان
                if (lower === '4h') {
                    console.log(`[Gecko Candles] Native 4h fetch failed for pool ${poolAddr}. Attempting fallback aggregation from 1h candles.`);
                    const raw1h = await fetchCandlesRaw(gtNetwork, poolAddr, 'hour', 1);
                    if (raw1h.data && raw1h.data.attributes && raw1h.data.attributes.ohlcv_list) {
                        const aggregatedList = aggregateCandles(raw1h.data.attributes.ohlcv_list, 4 * 3600);
                        const result = JSON.parse(JSON.stringify(raw1h));
                        result.data.attributes.ohlcv_list = aggregatedList;
                        return result;
                    }
                }
                throw err;
            }
        }
    };

    try {
        try {
            const result = await performFetch(pool);
            return res.json(result);
        } catch (err) {
            console.warn(`[Gecko Candles] First fetch failed for pool ${pool}: ${err.message}`);

            // ئەگەر دەستبەجێ پولەکە کاری نەکرد، هەوڵبدە لە ڕێگەی کانتراکتی دراوەکە خۆیەوە پولەکە بدۆزیتەوە لە GeckoTerminal
            if (token && token.trim() !== "" && pool !== token) {
                console.log(`[Gecko Candles] Attempting pool resolution for token ${token}`);
                const resolvedPool = await resolvePool(gtNetwork, token);
                if (resolvedPool && resolvedPool !== pool) {
                    console.log(`[Gecko Candles] Re-trying fetch with resolved pool ${resolvedPool}`);
                    const result = await performFetch(resolvedPool);
                    return res.json(result);
                } else {
                    throw new Error("هیچ پولێک بۆ ئەم تۆکنە نەدۆزرایەوە");
                }
            } else {
                throw err;
            }
        }
    } catch (err) {
        console.error(`[Gecko Candles] Error loading candles:`, err.message);
        return res.status(500).json({ error: "شکست لە بارکردنی مۆمەکان: " + err.message });
    }
});

// API Proxy بۆ GoPlus Token Security بۆ ڕێگری لە کێشەی CORS
app.get('/api/security', (req, res) => {
    const { chain, address } = req.query;

    let url;
    if (chain === "solana") {
        url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
    } else {
        url = `https://api.gopluslabs.io/api/v1/token_security/${chain}?contract_addresses=${address}`;
    }

    const request = https.get(url, { headers: { 'Accept': 'application/json' } }, (apiRes) => {
        let rawData = '';
        apiRes.on('data', (chunk) => rawData += chunk);
        apiRes.on('end', () => {
            if (res.headersSent) return;
            try {
                if (apiRes.statusCode !== 200) {
                    res.json({ code: 0, message: "GoPlus error status", result: {} });
                } else {
                    res.json(JSON.parse(rawData));
                }
            }
            catch (e) {
                res.json({ code: 0, message: "Parse error", result: {} });
            }
        });
    }).on('error', (err) => {
        if (res.headersSent) return;
        res.json({ code: 0, message: err.message, result: {} });
    });

    // بەسەرچوونی کات پاش 5 چرکە بۆ ئەوەی سێرڤەر نەوەستێت
    request.setTimeout(5000, () => {
        if (res.headersSent) return;
        request.destroy();
        res.json({ code: 0, message: "Request timeout", result: {} });
    });
});

// Helper to clean XML entities in RSS feed titles
function cleanXmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

// Helper to translate English crypto titles to Kurdish (ckb) using Google Translate free proxy API
function translateToKurdish(text) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ckb&dt=t&q=${encodeURIComponent(text)}`;
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && parsed[0] && parsed[0][0] && parsed[0][0][0]) {
                        resolve(parsed[0][0][0]);
                    } else {
                        resolve(text);
                    }
                } catch (e) {
                    resolve(text);
                }
            });
        }).on('error', () => {
            resolve(text);
        });
    });
}

// API for crypto token news translated to Kurdish (ckb)
app.get('/api/news', async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) {
        return res.status(400).json({ error: "Symbol is required" });
    }

    const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cacheKey = `news-${cleanSymbol}`;
    const now = Date.now();

    if (memoryCache[cacheKey] && memoryCache[cacheKey].expiry > now) {
        console.log(`[Cache Hit] News for ${cleanSymbol}`);
        return res.json(memoryCache[cacheKey].data);
    }

    console.log(`[Cache Miss] News for ${cleanSymbol}`);
    const googleNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanSymbol + ' crypto')}&hl=en-US&gl=US&ceid=US:en`;

    try {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        };

        https.get(googleNewsUrl, options, (rssRes) => {
            let xmlData = '';
            rssRes.on('data', chunk => xmlData += chunk);
            rssRes.on('end', async () => {
                try {
                    const items = [];
                    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
                    let match;
                    while ((match = itemRegex.exec(xmlData)) !== null) {
                        const itemContent = match[1];
                        const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
                        const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
                        const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
                        const sourceMatch = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/);

                        if (titleMatch) {
                            items.push({
                                title: cleanXmlEntities(titleMatch[1]),
                                link: linkMatch ? linkMatch[1] : '',
                                pubDate: pubDateMatch ? pubDateMatch[1] : '',
                                source: sourceMatch ? cleanXmlEntities(sourceMatch[1]) : 'Google News'
                            });
                        }
                    }

                    // Get top 5 news articles
                    const topItems = items.slice(0, 5);

                    // Translate concurrently
                    const translatedItems = await Promise.all(topItems.map(async (item) => {
                        let englishTitle = item.title;
                        const sourceIndex = englishTitle.lastIndexOf(' - ');
                        if (sourceIndex !== -1) {
                            englishTitle = englishTitle.substring(0, sourceIndex);
                        }

                        const translatedTitle = await translateToKurdish(englishTitle);
                        return {
                            ...item,
                            titleKurdish: translatedTitle,
                            titleEnglish: englishTitle
                        };
                    }));

                    memoryCache[cacheKey] = {
                        data: translatedItems,
                        expiry: Date.now() + 10 * 60 * 1000 // Cache for 10 minutes
                    };

                    res.json(translatedItems);
                } catch (e) {
                    res.status(500).json({ error: "Error parsing XML news" });
                }
            });
        }).on('error', (err) => {
            res.status(500).json({ error: err.message });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/log', (req, res) => {
    console.log('[Browser Log]', req.body);
    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});