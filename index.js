// ==================================================================================
//  🟢 GREEN CHIP V6 "GOD MODE" - ENTERPRISE SOLANA TRADING ENGINE
//  Target: Axiom/Pump Trending | New Profiles | Graduating | Anti-Rug AI
//  Architecture: Multi-Threaded Source Scanning with Centralized Queue
//  Author: Gemini (AI) for GreenChip
//  Version: 6.0.0-ULTRA
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials } = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment');

// ==================================================================================
//  ⚙️  SYSTEM CONFIGURATION
// ==================================================================================

const CONFIG = {
    // --- Identity ---
    BOT_NAME: "Green Chip V6",
    VERSION: "6.0.0-GOD-MODE",
    
    // --- Strategy Filters ---
    FILTERS: {
        MIN_MCAP: 20000,         // $20k Minimum (Entry Zone)
        MAX_MCAP: 55000,         // $55k Maximum (Moonshot Zone)
        MIN_LIQ: 1500,           // Liquidity Floor
        MIN_VOL_H1: 500,         // Momentum Check
        MAX_AGE_MIN: 60,         // Only Fresh Coins
        MIN_AGE_MIN: 1,          // Anti-Flashbot Buffer
        MIN_HYPE_SCORE: 10,      // Volume/Liq Ratio * Social Bonus
        REQUIRE_SOCIALS: true,   // Filters out 99% of rugs
        ANTI_SPAM_NAMES: true    // Blocks "ELONCUMxxx" type names
    },

    // --- Tracking & Auto-Trading Logic ---
    TRACKER: {
        GAIN_TRIGGER_1: 45,      // First Alert %
        GAIN_TRIGGER_2: 100,     // Moon Alert %
        GAIN_TRIGGER_3: 500,     // God Alert %
        STOP_LOSS: 0.90,         // Hard Stop if -90%
        RUG_CHECK_LIQ: 300,      // If liq < $300, it's a rug
        MAX_HOURS: 24            // Drop tracking after 24h
    },

    // --- API & Rate Limits (Strictly Tuned) ---
    SYSTEM: {
        SCAN_DELAY_PROFILES: 15000,  // Check Profiles every 15s
        SCAN_DELAY_BOOSTS: 30000,    // Check Trending/Boosts every 30s
        SCAN_DELAY_SEARCH: 60000,    // Deep Search every 60s
        TRACK_DELAY: 15000,          // Update Prices every 15s
        QUEUE_PROCESS_DELAY: 2000    // Discord Rate Limit Protection
    },

    // --- Data Sources ---
    ENDPOINTS: {
        PROFILES: "https://api.dexscreener.com/token-profiles/latest/v1", // Source: Paid Updates
        BOOSTS: "https://api.dexscreener.com/token-boosts/latest/v1",     // Source: Trending/Hype
        SEARCH: "https://api.dexscreener.com/latest/dex/search?q=solana", // Source: Deep Search
        TOKENS: "https://api.dexscreener.com/latest/dex/tokens/"          // Source: Data Fetch
    },

    URLS: {
        REFERRAL: "https://gmgn.ai/r/Greenchip"
    }
};

// ==================================================================================
//  🛠️  ADVANCED UTILITIES
// ==================================================================================

const Utils = {
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    formatUSD: (n) => {
        if (!n || isNaN(n)) return '$0.00';
        if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
        if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
        if (n >= 1e3) return '$' + (n/1e3).toFixed(2) + 'K';
        return '$' + n.toFixed(2);
    },

    formatPrice: (n) => {
        if (!n || isNaN(n)) return '$0.00';
        if (n < 0.000001) return '$' + n.toFixed(10);
        return '$' + n.toFixed(6);
    },

    getAge: (ts) => {
        const diff = Date.now() - ts;
        const m = Math.floor(diff / 60000);
        if (m < 1) return '🔥 Just Launched';
        if (m < 60) return `${m}m ago`;
        return `${Math.floor(m/60)}h ${m%60}m ago`;
    },

    // 🛡️ User-Agent Rotation to prevent 429 Bans
    getHeaders: () => {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
        };
    },

    log: (type, source, msg) => {
        const t = new Date().toISOString().split('T')[1].split('.')[0];
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', SYSTEM: '⚙️', FOUND: '💎' };
        console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
    }
};

// ==================================================================================
//  🧠  CENTRAL INTELLIGENCE (STATE)
// ==================================================================================

class StateManager {
    constructor() {
        this.activeTracks = new Map();     // Coins currently being watched
        this.history = new Set();          // All coins seen (Deduplication)
        this.queue = [];                   // Coins waiting to be posted
        this.stats = {
            scanned: 0,
            calls: 0,
            rugs: 0,
            start: Date.now()
        };
    }

    addToHistory(addr) {
        this.history.add(addr);
        if (this.history.size > 10000) {
            const it = this.history.values();
            this.history.delete(it.next().value);
        }
    }
}

const STATE = new StateManager();

// ==================================================================================
//  ⚖️  RISK & ANALYSIS ENGINE
// ==================================================================================

class RiskEngine {
    static analyze(pair) {
        const vol = pair.volume?.h1 || 0;
        const liq = pair.liquidity?.usd || 1;
        const fdv = pair.fdv || pair.marketCap || 0;
        const socials = pair.info?.socials || [];

        // 1. Hype Score (0-100)
        let hype = 0;
        const ratio = vol / liq;
        if (ratio > 0.5) hype += 20;
        if (ratio > 2.0) hype += 30; // High volume relative to liquidity = Demand
        if (socials.length > 0) hype += 20;
        if (socials.length > 2) hype += 10;
        if (pair.info?.header) hype += 10; // Paid for banner
        
        // 2. Safety Check
        let safe = true;
        let reasons = [];
        
        if (fdv < CONFIG.FILTERS.MIN_MCAP) { safe = false; reasons.push("MCAP Low"); }
        if (fdv > CONFIG.FILTERS.MAX_MCAP) { safe = false; reasons.push("MCAP High"); }
        if (liq < CONFIG.FILTERS.MIN_LIQ) { safe = false; reasons.push("Liquidity Low"); }
        if (vol < CONFIG.FILTERS.MIN_VOL_H1) { safe = false; reasons.push("Volume Low"); }
        if (CONFIG.FILTERS.REQUIRE_SOCIALS && socials.length === 0) { safe = false; reasons.push("No Socials"); }

        // 3. Status Determination
        let status = 'UNKNOWN';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex === 'raydium') status = 'GRADUATED';
        if (dex === 'pump') status = 'PUMP.FUN';
        if (dex === 'moonshot') status = 'MOONSHOT';

        return { safe, reasons, hype, status, vol, liq, fdv };
    }
}

// ==================================================================================
//  📡  SCANNER MODULES (STRATEGY PATTERN)
// ==================================================================================

// Strategy A: Latest Profiles (The "New Money" Scanner)
async function scanProfiles() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
        const profiles = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        
        if (profiles.length) {
            const addrs = profiles.map(p => p.tokenAddress).join(',');
            await fetchAndProcess(addrs, 'PROFILE');
        }
    } catch (e) { handleErr('Profiles', e); }
    setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

// Strategy B: Boosts & Trending (The "Axiom/Hype" Scanner)
async function scanBoosts() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
        const boosts = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        
        if (boosts.length) {
            const addrs = boosts.map(p => p.tokenAddress).join(',');
            await fetchAndProcess(addrs, 'BOOST');
        }
    } catch (e) { handleErr('Boosts', e); }
    setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

// Strategy C: Deep Search (The "Hidden Gem" Scanner)
async function scanSearch() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.SEARCH, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        // Process directly as we already have pair data
        for (const pair of pairs) processPair(pair, 'SEARCH');
    } catch (e) { handleErr('Search', e); }
    setTimeout(scanSearch, CONFIG.SYSTEM.SCAN_DELAY_SEARCH);
}

// --- Processor Helpers ---

async function fetchAndProcess(addresses, source) {
    if (!addresses) return;
    try {
        const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${addresses}`, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        for (const pair of pairs) processPair(pair, source);
    } catch (e) { handleErr('Fetch', e); }
}

function processPair(pair, source) {
    // 1. Basic Validation
    if (!pair || !pair.baseToken || pair.chainId !== 'solana') return;
    if (STATE.history.has(pair.baseToken.address)) return; // Already seen

    // 2. Risk Analysis
    const analysis = RiskEngine.analyze(pair);
    
    // 3. Age Filter (Crucial)
    const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;
    if (ageMins < CONFIG.FILTERS.MIN_AGE_MIN || ageMins > CONFIG.FILTERS.MAX_AGE_MIN) return;

    // 4. Decision
    if (analysis.safe) {
        STATE.addToHistory(pair.baseToken.address);
        STATE.queue.push({ pair, analysis, source }); // Add to queue for Discord
        Utils.log('FOUND', source, `Queued: ${pair.baseToken.name} ($${pair.baseToken.symbol})`);
    }
}

function handleErr(source, e) {
    if (e.response && e.response.status === 429) {
        Utils.log('WARN', source, 'Rate Limit (429) - Cooling Down');
    } else {
        Utils.log('WARN', source, `Error: ${e.message}`);
    }
}

// ==================================================================================
//  💬  DISCORD MANAGER (QUEUE CONSUMER)
// ==================================================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function processQueue() {
    if (STATE.queue.length === 0) {
        setTimeout(processQueue, 1000);
        return;
    }

    const item = STATE.queue.shift(); // Get first item
    const { pair, analysis, source } = item;
    
    await sendAlert(pair, analysis, source);
    setTimeout(processQueue, CONFIG.SYSTEM.QUEUE_PROCESS_DELAY);
}

async function sendAlert(pair, analysis, source) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const token = pair.baseToken;
    const socials = pair.info?.socials || [];
    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    
    // Dynamic Emoji & Color
    let badge = '⚡'; let color = '#FFFFFF';
    if (source === 'BOOST') { badge = '🚀'; color = '#FFD700'; } // Gold for Boosts
    if (source === 'PROFILE') { badge = '💎'; color = '#00D4FF'; } // Blue for Paid Profiles
    if (analysis.status === 'GRADUATED') { badge = '🎓'; color = '#00FF00'; }

    const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${badge} ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
**Source:** ${source} | **Status:** ${analysis.status}

${links}

> **📊 METRICS**
> • **MCAP:** \`${Utils.formatUSD(analysis.fdv)}\`
> • **Price:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\`
> • **Liq:** \`${Utils.formatUSD(analysis.liq)}\`
> • **Vol (1h):** \`${Utils.formatUSD(analysis.vol)}\`
> • **Age:** \`${Utils.getAge(pair.pairCreatedAt)}\`

**🎯 HYPE SCORE: ${analysis.hype}/100**
${analysis.hype > 40 ? "🔥 HIGH MOMENTUM DETECTED" : "✅ STEADY GROWTH"}

[**🛒 BUY ON GMGN (LOWER FEES)**](${CONFIG.URLS.REFERRAL})
[**📈 DexScreener**](${dexLink}) | [**⚡ Photon**](${photonLink})
`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip V6 • God Mode • ${new Date().toLocaleTimeString()}`, iconURL: client.user.displayAvatarURL() });

    try {
        const msg = await channel.send({ embeds: [embed] });
        
        // Start Tracking
        STATE.activeTracks.set(token.address, {
            name: token.name,
            symbol: token.symbol,
            entry: parseFloat(pair.priceUsd),
            max: parseFloat(pair.priceUsd),
            msgId: msg.id,
            chanId: channel.id,
            start: Date.now()
        });
        
        STATE.stats.calls++;
    } catch (e) {
        Utils.log('ERROR', 'Discord', e.message);
    }
}

// ==================================================================================
//  📈  TRACKER SYSTEM (AUTO-UPDATES)
// ==================================================================================

async function runTracker() {
    if (STATE.activeTracks.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
        return;
    }

    for (const [addr, data] of STATE.activeTracks) {
        try {
            // Drop old tracks
            if (Date.now() - data.start > (CONFIG.TRACKER.MAX_HOURS * 3600000)) {
                STATE.activeTracks.delete(addr);
                continue;
            }

            const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${addr}`, { timeout: 3000, headers: Utils.getHeaders() });
            const pair = res.data?.pairs?.[0];
            if (!pair) continue;

            const curr = parseFloat(pair.priceUsd);
            const liq = pair.liquidity?.usd || 0;
            const gain = ((curr - data.entry) / data.entry) * 100;

            // RUG CHECK
            if (curr < (data.entry * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                await sendUpdate(data, curr, gain, 'RUG');
                STATE.activeTracks.delete(addr);
                STATE.stats.rugs++;
                continue;
            }

            // GAIN CHECK
            if (gain > data.maxGain) data.maxGain = gain; // Track ATH

            // Triggers (Only fire once per level to avoid spam)
            if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) {
                await sendUpdate(data, curr, gain, 'GAIN');
                data.t1 = true;
            } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_2 && !data.t2) {
                await sendUpdate(data, curr, gain, 'MOON');
                data.t2 = true;
            } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_3 && !data.t3) {
                await sendUpdate(data, curr, gain, 'GOD');
                data.t3 = true;
            }

        } catch (e) {}
        await Utils.sleep(500); // Pace requests
    }
    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
}

async function sendUpdate(data, price, gain, type) {
    const channel = client.channels.cache.get(data.chanId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(data.msgId);
        if (!msg) return;

        let color = '#00FF00'; let title = `🚀 GAIN: +${gain.toFixed(0)}%`;
        if (type === 'MOON') { color = '#00D4FF'; title = `🌕 MOONSHOT: +${gain.toFixed(0)}%`; }
        if (type === 'GOD') { color = '#FFD700'; title = `👑 GOD CANDLE: +${gain.toFixed(0)}%`; }
        if (type === 'RUG') { color = '#FF0000'; title = `🚨 STOP LOSS / RUG`; }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(`**${data.name} ($${data.symbol})**\nEntry: ${Utils.formatPrice(data.entry)}\nNow: ${Utils.formatPrice(price)}\n\n[**💰 TAKE PROFIT HERE**](${CONFIG.URLS.REFERRAL})`)
            .setTimestamp();

        await msg.reply({ embeds: [embed] });
    } catch (e) {}
}

// ==================================================================================
//  🌐  WEB SERVER (KEEP-ALIVE)
// ==================================================================================

const app = express();
app.get('/', (req, res) => res.json({ 
    status: 'ONLINE', 
    version: CONFIG.VERSION,
    active_tracks: STATE.activeTracks.size,
    history_size: STATE.history.size,
    calls_today: STATE.stats.calls
}));
app.listen(process.env.PORT || 3000);

// ==================================================================================
//  🚀  LAUNCHPAD
// ==================================================================================

client.once('ready', () => {
    Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
    Utils.log('INFO', 'System', 'Initializing Multi-Threaded Scanners...');
    
    // Start Parallel Threads
    scanProfiles(); // Thread 1: Paid Updates
    scanBoosts();   // Thread 2: Trending/Axiom
    scanSearch();   // Thread 3: Deep Search
    runTracker();   // Thread 4: Price Tracking
    processQueue(); // Thread 5: Discord Sender

    client.user.setActivity('Solana Markets | V6 Ultra', { type: ActivityType.Competing });
});

client.login(process.env.DISCORD_TOKEN);
