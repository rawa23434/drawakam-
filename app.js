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

        // ❗️ پێویستە دڵنیا بین کە داتا بەردەستە
        if (!rawData || !rawData.data || !rawData.data.attributes || !rawData.data.attributes.ohlcv_list) {
            console.warn("GeckoTerminal data not available for this pool.");
            alert("هیچ داتایەک لە GeckoTerminal دەستنەکەوت بۆ ئەم دراوە.");
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

        // ڕێگریکردن لە دووبارەبوونەوەی کاتەکان کە دەبێتە هۆی کراشی چارتەکە
        const uniqueData = [];
        const seenTimes = new Set();
        for (const d of formattedData) {
            if (!seenTimes.has(d.time)) {
                seenTimes.add(d.time);
                uniqueData.push(d);
            }
        }
        
        // دڵنیابوونەوە لەوەی کاتەکان بە تەواوی لە بچووکەوە بۆ گەورە ڕیزکراون
        uniqueData.sort((a, b) => a.time - b.time);

        const cleanData = uniqueData.filter(d => 
            d.time != null && d.open != null && d.high != null && d.low != null && d.close != null && d.volume != null &&
            !isNaN(d.time) && !isNaN(d.open) && !isNaN(d.high) && !isNaN(d.low) && !isNaN(d.close) && !isNaN(d.volume)
        );

        if (cleanData.length === 0) {
            console.warn("No candle data found for this pool.");
            alert("داتای مۆمەکان بەتاڵە پاش فلتەرکردن.");
            return false;
        }

        try {
            renderChartData(cleanData, isRefresh);
        } catch (renderError) {
            alert("هەڵەیەک ڕوویدا لە کێشانی چارتەکە: " + renderError.message);
            console.error("Render Chart Error:", renderError);
            return false;
        }
        
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
    window.chartData = formattedData;

    if (priceChart && (!candlestickSeries || !volumeSeries || !smaSeries || !bbUpperSeries || !rsiSeries || !macdSeries)) {
        console.warn("Some chart components are missing. Recreating charts...");
        document.getElementById('price-chart').innerHTML = '';
        if (document.getElementById('rsi-chart')) document.getElementById('rsi-chart').innerHTML = '';
        if (document.getElementById('macd-chart')) document.getElementById('macd-chart').innerHTML = '';
        priceChart = null;
        rsiChart = null;
        macdChart = null;
    }

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

    if (!priceChart) {
        const priceContainer = document.getElementById('price-chart');
        const rsiContainer = document.getElementById('rsi-chart');
        const macdContainer = document.getElementById('macd-chart');
        
        priceChart = LightweightCharts.createChart(priceContainer, chartOptions);
        candlestickSeries = priceChart.addCandlestickSeries({
            upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
            wickUpColor: '#26a69a', wickDownColor: '#ef5350'
        });
        window.candlestickSeries = candlestickSeries;
        
            smaSeries = priceChart.addLineSeries({ color: '#2962ff', lineWidth: 2, title: 'SMA 20' });
            bbUpperSeries = priceChart.addLineSeries({ color: 'rgba(41, 98, 255, 0.4)', lineWidth: 1, title: 'BB Upper', lineStyle: 2 });
            bbLowerSeries = priceChart.addLineSeries({ color: 'rgba(41, 98, 255, 0.4)', lineWidth: 1, title: 'BB Lower', lineStyle: 2 });
            
            // زیادکردنی هێڵکاری ڤۆلیۆم وەک چینی خوارەوەی چارتی مۆمەکان
            volumeSeries = priceChart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: { type: 'volume' },
                priceScaleId: 'volume_scale', // بەستنەوەی بە پێوەری نرخی تایبەت
            });
            // ڕێکخستنی پێوەری نرخی ڤۆلیۆم بۆ ئەوەی لە خوارەوە بێت
            priceChart.priceScale('volume_scale').applyOptions({
                scaleMargins: { top: 0.8, bottom: 0 }, // 80% بۆشایی لە سەرەوەی بەشی ڤۆلیۆم
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
            if (range) {
                if (rsiChart) rsiChart.timeScale().setVisibleRange(range);
                if (macdChart) macdChart.timeScale().setVisibleRange(range);
            }
        });
        }

        // دڵنیابوونەوە لەوەی قەبارەی هێڵکارییەکە ڕاستە ئەگەر دەفرەکە پێشتر شاراوە بووبێت
        if (!isRefresh) {
            const currentWidth = document.getElementById('price-chart').clientWidth || 800;
            priceChart.resize(currentWidth, 500);
            if (rsiChart) rsiChart.resize(currentWidth, 150);
            if (macdChart) macdChart.resize(currentWidth, 150);
        }

        if (!candlestickSeries) throw new Error("candlestickSeries is undefined");
        
        try {
            // زۆر گرنگە: پاککردنەوەی نیشانەکانی پێشوو پێش تێکردنی داتای نوێ
            // چونکە ئەگەر نیشانەی کۆن بمێنێت و کاتەکەی لە داتا نوێیەکەدا نەبێت، کراش دەکات و دەڵێت Value is null
            candlestickSeries.setMarkers([]);
            candlestickSeries.setData(formattedData);
        } catch(e) { throw new Error("candlestickSeries.setData: " + e.message); }

        // تێکردنی داتای ڤۆلیۆم بە ڕەنگکردنی ستوونەکان
        const volumeData = formattedData.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
        }));
        if (!volumeSeries) throw new Error("volumeSeries is undefined");
        try {
            volumeSeries.setData(volumeData);
        } catch(e) { throw new Error("volumeSeries.setData: " + e.message); }

        // ئەنجامدانی حیساباتی ئیندیکاتۆرەکان
        const smaData = calculateSMA(formattedData, 20);
        if (!smaSeries) throw new Error("smaSeries is undefined");
        try {
            smaSeries.setData(smaData);
        } catch(e) { throw new Error("smaSeries.setData: " + e.message); }

        const bbData = calculateBollingerBands(formattedData, 20, 2);
        if (!bbUpperSeries) throw new Error("bbUpperSeries is undefined");
        if (!bbLowerSeries) throw new Error("bbLowerSeries is undefined");
        try {
            bbUpperSeries.setData(bbData.upper);
            bbLowerSeries.setData(bbData.lower);
        } catch(e) { throw new Error("bbSeries.setData: " + e.message); }

        const rsiData = calculateRSI(formattedData, 14);
        if (!rsiSeries) throw new Error("rsiSeries is undefined");
        try {
            rsiSeries.setData(rsiData);
        } catch(e) { throw new Error("rsiSeries.setData: " + e.message); }

        const macdData = calculateMACD(formattedData);
        if (!histSeries) throw new Error("histSeries is undefined");
        if (!macdSeries) throw new Error("macdSeries is undefined");
        if (!signalSeries) throw new Error("signalSeries is undefined");
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

    currentWs.onclose = () => {
        console.log("WebSocket disconnected. Reconnecting in 3 seconds...");
        setTimeout(() => {
            if (window.currentIsBinance) {
                setupRealtimeUpdates(symbol);
            }
        }, 3000);
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
        window.loadLiveChart('PEPE');
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
    
    if (!data || data.length < 15) return [];

    const interval = window.currentInterval || '1h';
    const isHigherTimeframe = ['1h', '2h', '4h', '1d'].includes(interval);
    
    // ئامادەکردنی ئیندیکاتۆرەکان بۆ بەهێزکردنی سیگناڵ
    const rsiMap = new Map(calculateRSI(data, 14).map(d => [d.time, d.value]));
    
    // ئامادەکردنی هێڵەکانی بۆلینجەر (Bollinger Bands)
    const bbData = calculateBollingerBands(data, 20, 2);
    const bbMap = new Map();
    for (let i = 0; i < bbData.lower.length; i++) {
        bbMap.set(bbData.lower[i].time, { lower: bbData.lower[i].value, upper: bbData.upper[i].value });
    }

    // ئامادەکردنی MACD بۆ فریمە بچووکەکان
    const macdData = calculateMACD(data);
    const macdMap = new Map(macdData.histogram.map(d => [d.time, d.value]));

    for (let i = 10; i < data.length - 1; i++) {
        const current = data[i];
        const next = data[i + 1];
        const prev = data[i - 1];
        
        // وەرگرتنی نرخی ئیندیکاتۆرەکان
        const currentRsi = rsiMap.get(current.time);
        const currentBb = bbMap.get(current.time);
        const currentMacdHist = macdMap.get(current.time);
        const prevMacdHist = macdMap.get(prev.time);
        
        // فلتەری توندی بۆلینجەر (Squeeze Filter) - ئەگەر بۆلینجەر زۆر تەسک بێت سیگناڵ نادات
        let isSqueezed = false;
        if (currentBb) {
            const bbWidth = (currentBb.upper - currentBb.lower) / currentBb.lower;
            if (bbWidth < 0.02) isSqueezed = true; // ئەگەر پانییەکەی کەمتر بێت لە %2، بازاڕ وەستاوە
        }
        
        if (isSqueezed && !isHigherTimeframe) continue; // بۆ فریمە بچووکەکان کاتی وەستان سیگناڵ نادات

        const lookback = isHigherTimeframe ? 5 : 3;
        let sumVol = 0;
        for (let j = 1; j <= lookback; j++) {
            sumVol += data[i - j].volume;
        }
        const avgVol = sumVol / lookback;
        
        const volumeMultiplier = isHigherTimeframe ? 2.0 : 1.5;
        const hasVolumeSpike = current.volume >= (avgVol * volumeMultiplier);

        if (!hasVolumeSpike) continue; 

        const currentBody = Math.abs(current.close - current.open);
        const lowerWick = Math.min(current.open, current.close) - current.low;
        const upperWick = current.high - Math.max(current.open, current.close);
        const nextBody = Math.abs(next.close - next.open);

        // ====================================================
        // 1. خوارەوەی ناوخۆیی (BUY THE DIP)
        // ====================================================
        let isLocalBottom = true;
        for (let j = 1; j <= 3; j++) {
            if (current.low >= data[i - j].low) isLocalBottom = false;
        }
        
        const isCurrentGreen = current.close > current.open; 
        const isNextGreen = next.close > next.open; 
        
        const hasLowerRejection = isHigherTimeframe ? (lowerWick >= currentBody * 0.8) : true;
        const hasStrongConfirmationBuy = isHigherTimeframe ? (next.close > current.open || nextBody >= currentBody * 0.5) : true;
        
        let buyIndicatorsValid = true;
        if (isHigherTimeframe && currentRsi !== undefined && currentBb !== undefined) {
            const rsiValid = currentRsi < 45;
            const bbValid = current.low <= currentBb.lower * 1.01; 
            buyIndicatorsValid = rsiValid && bbValid;
        } else if (!isHigherTimeframe && currentMacdHist !== undefined && prevMacdHist !== undefined) {
            // بۆ فریمە بچووکەکان، MACD دەبێت ئاماژە بە پێچەوانەبوونەوە بکات (Histogram لە دابەزینەوە بگەڕێتەوە یان سەوز بێت)
            const macdReversingUp = currentMacdHist > prevMacdHist;
            buyIndicatorsValid = macdReversingUp;
        }

        if (isLocalBottom && isCurrentGreen && isNextGreen && hasLowerRejection && hasStrongConfirmationBuy && buyIndicatorsValid) {
            markers.push({
                time: current.time,
                position: 'belowBar',
                color: '#26a69a',
                shape: 'arrowUp',
                text: isHigherTimeframe ? '🟢 STRONG BUY' : '🔥 MEME DIP'
            });
            continue; 
        }

        // ====================================================
        // 2. لوتکەی ناوخۆیی (SELL THE PEAK)
        // ====================================================
        let isLocalTop = true;
        for (let j = 1; j <= 3; j++) {
            if (current.high <= data[i - j].high) isLocalTop = false;
        }

        const isCurrentRed = current.close < current.open; 
        const isNextRed = next.close < next.open;          
        
        const hasUpperRejection = isHigherTimeframe ? (upperWick >= currentBody * 0.8) : true;
        const hasStrongConfirmationSell = isHigherTimeframe ? (next.close < current.open || nextBody >= currentBody * 0.5) : true;
        
        let sellIndicatorsValid = true;
        if (isHigherTimeframe && currentRsi !== undefined && currentBb !== undefined) {
            const rsiValid = currentRsi > 55;
            const bbValid = current.high >= currentBb.upper * 0.99;
            sellIndicatorsValid = rsiValid && bbValid;
        } else if (!isHigherTimeframe && currentMacdHist !== undefined && prevMacdHist !== undefined) {
            // بۆ فریمە بچووکەکان، MACD دەبێت ئاماژە بە پێچەوانەبوونەوە بکات (Histogram لە بەرزبوونەوە بگەڕێتەوە یان سوور بێت)
            const macdReversingDown = currentMacdHist < prevMacdHist;
            sellIndicatorsValid = macdReversingDown;
        }

        if (isLocalTop && isCurrentRed && isNextRed && hasUpperRejection && hasStrongConfirmationSell && sellIndicatorsValid) {
            markers.push({
                time: current.time,
                position: 'aboveBar',
                color: '#ef5350',
                shape: 'arrowDown',
                text: isHigherTimeframe ? '🔴 STRONG SELL' : '🚨 MEME PEAK'
            });
        }
    }

    return markers;
};

// ئاشکراکردنی جوڵەی نهەنگەکان لەسەر بنەمای بەرزبوونەوەی زەبەلاحی قەبارە (Whale Detection)
window.generateWhaleMarkers = function(data) {
    const markers = [];
    if (!data || data.length < 25) return markers;

    for (let i = 20; i < data.length; i++) {
        const current = data[i];
        
        // تێکڕای قەبارەی ٢٠ مۆمی پێشوو
        let sumVol = 0;
        for (let j = 1; j <= 20; j++) {
            sumVol += data[i - j].volume;
        }
        const avgVol = sumVol / 20;

        // ئەگەر قەبارە زۆر بەرز بوو (٤ هێندەی تێکڕا)
        if (current.volume > (avgVol * 4) && current.volume > 0) {
            const isGreen = current.close > current.open;
            const isRed = current.close < current.open;
            
            if (isGreen) {
                markers.push({
                    time: current.time,
                    position: 'belowBar',
                    color: '#00c853',
                    shape: 'arrowUp',
                    text: '🐳 BUY',
                    size: 2
                });
            } else if (isRed) {
                markers.push({
                    time: current.time,
                    position: 'aboveBar',
                    color: '#ff5252',
                    shape: 'arrowDown',
                    text: '🐳 SELL',
                    size: 2
                });
            }
        }
    }
    return markers;
};

// جێبەجێکردنی ئەلگۆریتمەکە و نەخشەسازی لەسەر چارتەکە (Plotting)
window.applyMemeSignalsToChart = function(securityData) {
    if (!window.chartData || !window.candlestickSeries) return;

    const data = window.chartData;
    
    // وەرگرتنی ڕیزبەندی نیشانەکان (Markers Array) بە پێی ئەلگۆریتمە نوێیەکە
    const newMarkers = window.generateMemeReversalSignals(data, securityData);
    
    // وەرگرتنی نیشانەکانی نهەنگ
    const whaleMarkers = window.generateWhaleMarkers(data);

    // پاراستنی هەر نیشانەیەکی پێشوو (وەک خاڵی کڕینی پۆرتفۆلیۆ) ئەگەر هەبوو
    const existingMarkers = window.customTradeMarkers || []; 
    
    // کۆکردنەوە و ڕیزکردنی کاتی بۆ ئەوەی بەیەکەوە پیشان بدرێن
    const allMarkers = [...existingMarkers, ...newMarkers, ...whaleMarkers].sort((a, b) => a.time - b.time);
    
    window.candlestickSeries.setMarkers(allMarkers);
};

// ڕێکخستنەوەی قەبارەی چارتەکان لە کاتی گۆڕانی قەبارەی پەنجەرە (شاشە)
window.addEventListener('resize', () => {
    if (priceChart) {
        const currentWidth = document.getElementById('price-chart').clientWidth || 800;
        priceChart.resize(currentWidth, 500);
        if (rsiChart) rsiChart.resize(currentWidth, 150);
        if (macdChart) macdChart.resize(currentWidth, 150);
    }
});

// Advanced Candlestick Pattern Detection (بەهێزکراو بە ئیندیکاتۆرەکان)
window.detectCandlePatterns = function(candles) {
    if (!candles || candles.length < 15) return { hasHammer: false, hasShootingStar: false, hasBullishEngulfing: false, hasBearishEngulfing: false };
    
    // وەرگرتنی پێوەری RSI بۆ دڵنیابوونەوە لەوەی لە ناوچەیەکی گونجاوداین (زۆر کڕدراو یان زۆر فرۆشراو)
    const rsiData = calculateRSI(candles, 14);
    const currentRsi = rsiData.length > 0 ? rsiData[rsiData.length - 1].value : 50;
    const prevRsi = rsiData.length > 1 ? rsiData[rsiData.length - 2].value : 50;

    const curr = candles[candles.length - 1]; 
    const prev = candles[candles.length - 2];
    
    // حیسابکردنی تێکڕای قەبارەی مامەڵەی ٥ مۆمی پێشوو بۆ دڵنیابوونەوە لە بوونی هێز
    let sumVol = 0;
    for (let i = 2; i <= 6; i++) {
        if (candles[candles.length - i]) {
            sumVol += candles[candles.length - i].volume;
        }
    }
    const avgVol = sumVol / 5;

    // مەرجەکانی چەکوش (Hammer)
    const isHammer = (candle, rsiValue) => {
        const bodyLength = Math.abs(candle.close - candle.open);
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        const totalLength = candle.high - candle.low;
        if (totalLength === 0) return false;
        
        // مەرجەکان: کلکی خوارەوە درێژ بێت، کلکی سەرەوە کورت بێت، قەبارە بەرز بێت، وە RSI لە خوار ٤٥ بێت (واتە بازاڕ دابەزیوە)
        const shapeValid = lowerWick >= 1.5 * bodyLength && upperWick <= totalLength * 0.25 && bodyLength > 0;
        const contextValid = candle.volume >= avgVol * 1.2 && rsiValue < 45;
        return shapeValid && contextValid;
    };

    // مەرجەکانی ئەستێرەی کشاو (Shooting Star)
    const isShootingStar = (candle, rsiValue) => {
        const bodyLength = Math.abs(candle.close - candle.open);
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        const totalLength = candle.high - candle.low;
        if (totalLength === 0) return false;
        
        // مەرجەکان: کلکی سەرەوە درێژ بێت، قەبارە بەرز بێت، وە RSI لە سەرووی ٥٥ بێت
        const shapeValid = upperWick >= 1.5 * bodyLength && lowerWick <= totalLength * 0.25 && bodyLength > 0;
        const contextValid = candle.volume >= avgVol * 1.2 && rsiValue > 55;
        return shapeValid && contextValid;
    };

    // قوتدانی سەوز (Bullish Engulfing)
    const isBullishEngulfing = (prev, curr, rsiValue) => {
        const prevIsRed = prev.close < prev.open;
        const currIsGreen = curr.close > curr.open;
        const shapeValid = prevIsRed && currIsGreen && curr.close >= prev.open && curr.open <= prev.close;
        const contextValid = curr.volume >= avgVol * 1.2 && rsiValue < 45;
        return shapeValid && contextValid;
    };

    // قوتدانی سوور (Bearish Engulfing)
    const isBearishEngulfing = (prev, curr, rsiValue) => {
        const prevIsGreen = prev.close > prev.open;
        const currIsRed = curr.close < curr.open;
        const shapeValid = prevIsGreen && currIsRed && curr.close <= prev.open && curr.open >= prev.close;
        const contextValid = curr.volume >= avgVol * 1.2 && rsiValue > 55;
        return shapeValid && contextValid;
    };

    return {
        hasHammer: isHammer(curr, currentRsi) || isHammer(prev, prevRsi),
        hasShootingStar: isShootingStar(curr, currentRsi) || isShootingStar(prev, prevRsi),
        hasBullishEngulfing: isBullishEngulfing(prev, curr, currentRsi),
        hasBearishEngulfing: isBearishEngulfing(prev, curr, currentRsi)
    };
};
