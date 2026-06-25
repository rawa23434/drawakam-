const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    
    async function testPage(url) {
        console.log(`\n--- Testing URL: ${url} ---`);
        const page = await browser.newPage();
        
        // Listen for console messages
        page.on('console', msg => {
            console.log(`[Browser Console - ${msg.type()}]:`, msg.text());
        });

        // Listen for page errors (exceptions)
        page.on('pageerror', err => {
            console.error('[Browser Error]:', err.toString());
        });

        await page.goto(url, { waitUntil: 'networkidle2' });
        
        // Let's input a contract address
        // Sol or some token: SOL contract is 7xKX1ZdPmBjZs7Gt5p8qUQQFadP56nQ6Jc484K3x3e8F or similar
        // Let's use a real token address. Let's use "SOL" as text first, or a contract like "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
        console.log('Typing contract address...');
        await page.type('#contractInput', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
        
        console.log('Clicking search button...');
        await page.click('#searchBtn');
        
        // Wait for some time to let it fetch and process
        await new Promise(r => setTimeout(r, 6000));
        
        await page.close();
    }

    try {
        await testPage('http://localhost:8080/index.html');
        await testPage('http://localhost:8080/topcoins.html');
    } catch (e) {
        console.error('Test execution failed:', e);
    } finally {
        await browser.close();
    }
})();
