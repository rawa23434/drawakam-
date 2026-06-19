/**
 * PUBLIC CRYPTO CHART PROTOTYPE
 * وەشانی نوێکراوە بۆ چارەسەری کێشەی هێماکان و دڵنیابوونەوە لە داتا
 */

let priceChart, rsiChart, macdChart, candlestickSeries, smaSeries, bbUpperSeries, bbLowerSeries, volumeSeries, rsiSeries, macdSeries, signalSeries, histSeries, currentWs, geckoRefreshInterval;

window.loadLiveChart = async function(symbol = 'BTC', interval = '1h') {
    try {
        // ڕاگرتنی نوێکردنەوەی جێکۆ ئەگەر دراوەکە هی باینانس بوو
        if (geckoRefreshInterval) {
            clearInterval(geckoRefreshInterval);
            geckoRefreshInterval = null;
        }

        window.currentIsBinance = true;
        window.currentInterval = interval;

        const binanceSymbol = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
        // بەکارهێنانی خاڵی کۆتایی باکئەند لە جیاتی باینانس بۆ چارەسەری CORS
        const url = `/api/candles?symbol=${binanceSymbol}&interval=${interval}`;
        
        const response = await fetch(url);
        
        const rawData = await response.json();

        if (!Array.isArray(rawData)) {
            console.warn("Binance data not available for this symbol.");
            return false; // نیشانەی ئەوەیە دراوەکە لە باینانس نییە
        }
        if (rawData.length === 0) {
            return false;
        }

        // فۆرماتکردنی داتاکان بۆ Lightweight Charts
        const formattedData = rawData.map(d => ({
            time: d[0] / 1000,
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
        })).sort((a, b) => a.time - b.time);

        renderChartData(formattedData);

        // بەستنەوە بە WebSocket بۆ نوێکردنەوەی سات بە سات
        setupRealtimeUpdates(binanceSymbol);

        return true; // سەرکەوتوو بوو لە بارکردنی چارت

    } catch (error) {
        console.error("Error loading Binance data:", error);
        return false;
    }
};

window.loadDexChart = async function(network, poolAddress, tokenAddress = '', isRefresh = false, interval = '1h') {
    try {
        window.currentIsBinance = false;
        window.currentNetwork = network;
        window.currentPoolAddress = poolAddress;
        window.currentTokenAddress = tokenAddress;
        window.currentInterval = interval;

        const url = `/api/gecko-candles?network=${network}&pool=${poolAddress}&token=${tokenAddress}&interval=${interval}`;
        const response = await fetch(url);
        const rawData = await response.json();

        if (!rawData.data || !rawData.data.attributes || !rawData.data.attributes.ohlcv_list) {
            console.warn("GeckoTerminal data not available for this pool.");
            return false;
        }

        const ohlcv = rawData.data.attributes.ohlcv_list;
        const formattedData = ohlcv.map(d => ({
            time: d[0], // لە جیگکۆتێرمیناڵ کاتەکە بە چرکەیە
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
        })).reverse(); // پێچەوانەی دەکەینەوە چونکە جیگکۆتێرمیناڵ نوێترین دەداتە سەرەتا

        if (formattedData.length === 0) {
            console.warn("No candle data found for this pool.");
            return false;
        }

        renderChartData(formattedData, isRefresh);
        
        // ڕاگرتنی ڵایڤی باینانس ئەگەر هەبوو، چونکە ئەمە دراوی دەرەوەیە
        if (currentWs) {
            currentWs.close();
            currentWs = null;
        }

        // کارپێکردنی نوێکردنەوەی ئۆتۆماتیکی (Auto Refresh) هەر ٦٠ چرکە جارێک
        if (!isRefresh) {
            if (geckoRefreshInterval) clearInterval(geckoRefreshInterval);
            geckoRefreshInterval = setInterval(() => {
                window.loadDexChart(network, poolAddress, tokenAddress, true, interval);
            }, 60000);
        }

        return true;
    } catch (error) {
        console.error("Error loading DEX data:", error);
        return false;
    }
};

function renderChartData(formattedData, isRefresh = false) {
        const isLightMode = document.body.classList.contains('light-mode');
        const bg = isLightMode ? '#ffffff' : '#131722';
        const text = isLightMode ? '#131722' : '#d1d4dc';
        const grid = isLightMode ? '#e0e3eb' : '#2a2e39';

        const chartOptions = {
            layout: { background: { color: bg }, textColor: text },
            grid: { vertLines: { color: grid }, horzLines: { color: grid } },
            timeScale: { borderColor: grid, timeVisible: true },
            width: document.getElementById('price-chart').clientWidth || 800,
            height: 500
        };
    
    // هەڵگرتنی داتای چارتەکە بۆ ئەوەی بەشی مامەڵە بتوانێت بیخوێنێتەوە
    window.chartData = formattedData;

        // دروستکردنی هێڵکارییەکان تەنها بۆ یەکجار (Singleton Pattern)
        if (!priceChart) {
            const priceContainer = document.getElementById('price-chart');
            const rsiContainer = document.getElementById('rsi-chart');
            const macdContainer = document.getElementById('macd-chart');
            
            priceChart = LightweightCharts.createChart(priceContainer, chartOptions);
            candlestickSeries = priceChart.addCandlestickSeries({
                upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
                wickUpColor: '#26a69a', wickDownColor: '#ef5350'
            });
        window.candlestickSeries = candlestickSeries; // ئیکسپۆرتکردن بۆ دانانی نیشانە لەسەر چارت
        
            smaSeries = priceChart.addLineSeries({ color: '#2962ff', lineWidth: 2, title: 'SMA 20' });
            bbUpperSeries = priceChart.addLineSeries({ color: 'rgba(41, 98, 255, 0.4)', lineWidth: 1, title: 'BB Upper', lineStyle: 2 });
            bbLowerSeries = priceChart.addLineSeries({ color: 'rgba(41, 98, 255, 0.4)', lineWidth: 1, title: 'BB Lower', lineStyle: 2 });
            
            // زیادکردنی هێڵکاری ڤۆلیۆم وەک چینی خوارەوەی چارتی مۆمەکان
            volumeSeries = priceChart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: { type: 'volume' },
                priceScaleId: '', // دانانی لەسەر هەمان چارت
            });
            priceChart.priceScale('').applyOptions({
                scaleMargins: { top: 0.8, bottom: 0 }, // تەنها %20ی بەشی خوارەوە بگرێت
            });
            
            rsiChart = LightweightCharts.createChart(rsiContainer, { 
                ...chartOptions, 
                height: 150,
                width: rsiContainer.clientWidth || 800
            });
            rsiSeries = rsiChart.addLineSeries({ color: '#ff9800', lineWidth: 2, title: 'RSI 14' });

            macdChart = LightweightCharts.createChart(macdContainer, { 
                ...chartOptions, 
                height: 150,
                width: macdContainer.clientWidth || 800
            });
            histSeries = macdChart.addHistogramSeries({ color: '#26a69a' });
            macdSeries = macdChart.addLineSeries({ color: '#2962ff', lineWidth: 2, title: 'MACD' });
            signalSeries = macdChart.addLineSeries({ color: '#ff9800', lineWidth: 2, title: 'Signal' });

            // هاوکاتکردنی کاتی هەردوو هێڵکارییەکە
            priceChart.timeScale().subscribeVisibleTimeRangeChange(range => {
                rsiChart.timeScale().setVisibleRange(range);
                macdChart.timeScale().setVisibleRange(range);
            });
        }

        // دڵنیابوونەوە لەوەی قەبارەی هێڵکارییەکە ڕاستە ئەگەر دەفرەکە پێشتر شاراوە بووبێت
        // بەکارهێنانی fallback ئەگەر clientWidth سفر بوو
        const currentWidth = document.getElementById('price-chart').clientWidth || 800;
        priceChart.resize(currentWidth, 500);
        rsiChart.resize(currentWidth, 150);
        macdChart.resize(currentWidth, 150);

        candlestickSeries.setData(formattedData);

        // تێکردنی داتای ڤۆلیۆم بە ڕەنگکردنی ستوونەکان
        const volumeData = formattedData.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
        }));
        volumeSeries.setData(volumeData);

        // ئەنجامدانی حیساباتی ئیندیکاتۆرەکان
        const smaData = calculateSMA(formattedData, 20);
        smaSeries.setData(smaData);

        const bbData = calculateBollingerBands(formattedData, 20, 2);
        bbUpperSeries.setData(bbData.upper);
        bbLowerSeries.setData(bbData.lower);

        const rsiData = calculateRSI(formattedData, 14);
        rsiSeries.setData(rsiData);

        const macdData = calculateMACD(formattedData);
        histSeries.setData(macdData.histogram);
        macdSeries.setData(macdData.macdLine);
        signalSeries.setData(macdData.signalLine);

        // ئەگەر تەنها نوێکردنەوەیە، با زوومی بەکارهێنەر تێکنەچێت
        if (!isRefresh) {
            priceChart.timeScale().fitContent();
        }

        // جێبەجێکردنی سیگناڵەکان ڕاستەوخۆ بۆ ئەوەی خێرا بیانبینیت لەسەر چارتەکە
        if (window.applyMemeSignalsToChart) {
            window.applyMemeSignalsToChart(window.currentSecurityData || null);
        }
}

window.updateChartTheme = function(isLightMode) {
    if (!priceChart) return;
    const bg = isLightMode ? '#ffffff' : '#131722';
    const text = isLightMode ? '#131722' : '#d1d4dc';
    const grid = isLightMode ? '#e0e3eb' : '#2a2e39';
    
    const themeOptions = {
        layout: { background: { color: bg }, textColor: text },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        timeScale: { borderColor: grid }
    };

    priceChart.applyOptions(themeOptions);
    if (rsiChart) rsiChart.applyOptions(themeOptions);
    if (macdChart) macdChart.applyOptions(themeOptions);
};

function setupRealtimeUpdates(symbol) {
    if (currentWs) currentWs.close();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    currentWs = new WebSocket(`${protocol}//${window.location.host}`);

    currentWs.onopen = () => {
        currentWs.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: symbol }));
    };

    currentWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.e === 'kline') {
            const k = data.k;
            const candle = {
                time: k.t / 1000,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c)
            };
            candlestickSeries.update(candle);
            
            // نوێکردنەوەی ڤۆلیۆم ڕاستەوخۆ بە WebSocket
            volumeSeries.update({
                time: k.t / 1000,
                value: parseFloat(k.v),
                color: parseFloat(k.c) >= parseFloat(k.o) ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
            });
        }
    };
}

function calculateSMA(data, period) {
    const sma = [];
    for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((acc, curr) => acc + curr.close, 0);
        sma.push({ time: data[i].time, value: sum / period });
    }
    return sma;
}

function calculateRSI(data, period) {
    const rsiData = [];
    const gains = [];
    const losses = [];
    for (let i = 1; i < data.length; i++) {
        const diff = data[i].close - data[i - 1].close;
        gains.push(Math.max(0, diff));
        losses.push(Math.max(0, -diff));
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < data.length; i++) {
        const rs = avgGain / (avgLoss || 1);
        rsiData.push({ time: data[i].time, value: 100 - (100 / (1 + rs)) });
        avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
        avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    }
    return rsiData;
}

function calculateBollingerBands(data, period, multiplier) {
    const bbData = { upper: [], lower: [] };
    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - period + 1, i + 1);
        const sum = slice.reduce((acc, curr) => acc + curr.close, 0);
        const sma = sum / period;
        const variance = slice.reduce((acc, curr) => acc + Math.pow(curr.close - sma, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        
        bbData.upper.push({ time: data[i].time, value: sma + (stdDev * multiplier) });
        bbData.lower.push({ time: data[i].time, value: sma - (stdDev * multiplier) });
    }
    return bbData;
}

function calculateEMA(data, period, key = 'close') {
    const k = 2 / (period + 1);
    const emaData = [];
    let ema = data[0][key];
    emaData.push({ time: data[0].time, value: ema });
    for (let i = 1; i < data.length; i++) {
        ema = (data[i][key] - ema) * k + ema;
        emaData.push({ time: data[i].time, value: ema });
    }
    return emaData;
}

function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEma = calculateEMA(data, fastPeriod, 'close');
    const slowEma = calculateEMA(data, slowPeriod, 'close');
    const macdLine = [];
    for (let i = 0; i < data.length; i++) {
        macdLine.push({ time: data[i].time, value: fastEma[i].value - slowEma[i].value });
    }
    const signalLine = calculateEMA(macdLine, signalPeriod, 'value');
    const histogram = [];
    for (let i = 0; i < data.length; i++) {
        const histValue = macdLine[i].value - signalLine[i].value;
        let color = histValue >= 0 ? '#26a69a' : '#ef5350'; // ڕەنگی بنەڕەتی
        if (i > 0) {
            const prevHist = histogram[i-1].value;
            if (histValue >= 0) color = histValue >= prevHist ? '#26a69a' : '#b2dfdb'; // سەوزی تۆخ/کاڵ
            else color = histValue <= prevHist ? '#ef5350' : '#ef9a9a'; // سووری تۆخ/کاڵ
        }
        histogram.push({ time: data[i].time, value: histValue, color: color });
    }
    return { macdLine, signalLine, histogram };
}

// بارکردنی سەرەتایی کاتێک پەڕەکە دەبێتەوە
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('price-chart')) {
        window.loadLiveChart('BTC');
    }
});

// =========================================================================
// --- ئەلگۆریتمی پێچەوانەبوونەوەی خێرای میمکۆین (3-Candle Reversal Algorithm) ---
// =========================================================================

window.generateMemeReversalSignals = function(data, securityData) {
    let markers = [];

    // فلتەری ئاسایش (پاراستنی فەرش): ئەگەر دراوەکە ساختە بێت سیگناڵی درۆینە نادات
    if (securityData) {
        const isHoneypot = securityData.is_honeypot === "1" || securityData.is_honeypot === true;
        if (isHoneypot) {
            return [];
        }
    }

    // لوپەکە لە ئیندێکسی 3 دەستپێدەکات (بۆ 3 مۆمی پێشوو) و لە پێش کۆتا مۆم دەوەستێت (بۆ 1 مۆمی داهاتوو)
    for (let i = 3; i < data.length - 1; i++) {
        const current = data[i];
        const next = data[i + 1];
        const prev1 = data[i - 1];
        const prev2 = data[i - 2];
        const prev3 = data[i - 3];

        // 1. فلتەری دەنگ (Anti-Fake Filter): قەبارە دەبێت %150 ی تێکڕای 3 مۆمی پێشوو بێت
        const avgVol3 = (prev1.volume + prev2.volume + prev3.volume) / 3;
        const hasVolumeSpike = current.volume >= (avgVol3 * 1.5);

        if (!hasVolumeSpike) continue; // ئەگەر قەبارە کەم بوو، سیگناڵەکە پشتگوێ بخە

        // 2. خوارەوەی ناوخۆیی (BUY THE DIP)
        const isLocalBottom = current.low < Math.min(prev1.low, prev2.low, prev3.low);
        const isCurrentGreen = current.close > current.open; // مۆمی ئێستا سەوزە
        const isNextGreen = next.close > next.open;          // مۆمی پشتڕاستکردنەوە سەوزە

        if (isLocalBottom && isCurrentGreen && isNextGreen) {
            markers.push({
                time: current.time,
                position: 'belowBar',
                color: '#26a69a',
                shape: 'arrowUp',
                text: '🔥 MEME DIP / BUY'
            });
            continue; // ئەگەر کڕین بوو، بەردەوام بە بۆ مۆمی داهاتوو
        }

        // 3. لوتکەی ناوخۆیی (SELL THE PEAK)
        const isLocalTop = current.high > Math.max(prev1.high, prev2.high, prev3.high);
        const isCurrentRed = current.close < current.open; // مۆمی ئێستا سوورە
        const isNextRed = next.close < next.open;          // مۆمی پشتڕاستکردنەوە سوورە

        if (isLocalTop && isCurrentRed && isNextRed) {
            markers.push({
                time: current.time,
                position: 'aboveBar',
                color: '#ef5350',
                shape: 'arrowDown',
                text: '🚨 MEME PEAK / SELL'
            });
        }
    }

    return markers;
};

// جێبەجێکردنی ئەلگۆریتمەکە و نەخشەسازی لەسەر چارتەکە (Plotting)
window.applyMemeSignalsToChart = function(securityData, chainMetricsData = null) {
    if (!window.chartData || !window.candlestickSeries) return;

    const data = window.chartData;
    
    // وەرگرتنی ڕیزبەندی نیشانەکان (Markers Array) بە پێی ئەلگۆریتمە نوێیەکە
    const newMarkers = window.generateMemeReversalSignals(data, securityData);

    // پاراستنی هەر نیشانەیەکی پێشوو (وەک خاڵی کڕینی پۆرتفۆلیۆ) ئەگەر هەبوو
    const existingMarkers = window.customTradeMarkers || []; 
    window.candlestickSeries.setMarkers([...existingMarkers, ...newMarkers]);
};