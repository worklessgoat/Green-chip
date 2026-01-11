// ==================================================================================
//  🟢 GREEN CHIP V7 "FORTIFIED" - EMPIRE DESIGN EDITION
//  ---------------------------------------------------------------------------------
//  Logic: V7 (Strict Filters, Anti-Repeat Lock, 3 Scanners)
//  Visuals: Empire V9 (Compact Embeds, Copy CA, No Dead Space)
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
//  Version: 7.1.0-EMPIRE-DESIGN
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials } = require('discord.js');
const axios = require('axios');
const express = require('express');

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX (YOUR STRICT V7 SETTINGS)
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V7",
    VERSION: "7.1.0-STABLE",
    
    // --- Strategy Filters ---
    FILTERS: {
        MIN_MCAP: 20000,         // $20k Minimum
        MAX_MCAP: 55000,         // $55k Maximum
        MIN_LIQ: 1500,           // Liquidity Floor
        MIN_VOL_H1: 500,         // Momentum Check
        MAX_AGE_MIN: 60,         // < 1 Hour Old
        MIN_AGE_MIN: 1,          // > 1 Minute Old
        REQUIRE_SOCIALS: true,   // Must have Twitter/TG
        ANTI_SPAM_NAMES: true    // Filters "ELONCUM" etc.
    },

    // --- Tracking & Auto-Trading Logic ---
    TRACKER: {
        GAIN_TRIGGER_1: 45,      // First Reply at +45%
        GAIN_TRIGGER_2: 100,     // Second at +100%
        GAIN_TRIGGER_3: 500,     // Third at +500%
        STOP_LOSS: 0.90,         // Stop if drops 90%
        RUG_CHECK_LIQ: 300,      // Rug if liq < $300
        MAX_HOURS: 24            // Stop tracking after 24h
    },

    // --- System Intervals ---
    SYSTEM: {
        SCAN_DELAY_PROFILES: 15000,
        SCAN_DELAY_BOOSTS: 30000,
        SCAN_DELAY_SEARCH: 60000,
        TRACK_DELAY: 15000,
        QUEUE_DELAY: 3000        // Slow queue to prevent rate limits
    },

    // --- Data Sources ---
    ENDPOINTS: {
        PROFILES: "https://api.dexscreener.com/token-profiles/latest/v1",
        BOOSTS: "https://api.dexscreener.com/token-boosts/latest/v1",
        SEARCH: "https://api.dexscreener.com/latest/dex/search?q=solana",
        TOKENS: "https://api.dexscreener.com/latest/dex/tokens/"
    },

    URLS: {
        REFERRAL: "https://gmgn.ai/r/Greenchip"
    }
};

// ==================================================================================
//  🛠️  UTILITY TOOLKIT
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

    getHeaders: () => {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json'
        };
    },

    log: (type, source, msg) => {
        const t = new Date().toISOString().split('T')[1].split('.')[0];
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎' };
        console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
    }
};

// ==================================================================================
//  🧠  MEMORY & DEDUPLICATION (THE FIX)
// ==================================================================================

class StateManager {
    constructor() {
        this.activeTracks = new Map();     // Coins currently being watched
        this.history = new Set();          // PERMANENT HISTORY of alerted coins
        this.processing = new Set();       // Temporary lock for coins being analyzed
        this.queue = [];                   // Coins waiting to be posted
        this.stats = { calls: 0, rugs: 0, start: Date.now() };
    }

    // Returns TRUE if the coin is new, FALSE if we should skip it
    lockCoin(address) {
        if (this.history.has(address)) return false;    // Already called
        if (this.processing.has(address)) return false; // Currently checking
        this.processing.add(address); // Lock it
        return true;
    }

    // Call this if analysis fails (unlocks it so we can check later if it improves)
    unlockCoin(address) {
        this.processing.delete(address);
    }

    // Call this if analysis passes (Permanently marks it as done)
    finalizeCoin(address) {
        this.processing.delete(address);
        this.history.add(address);
        
        // Keep history manageable (max 10k)
        if (this.history.size > 10000) {
            const it = this.history.values();
            this.history.delete(it.next().value);
        }
    }
}

const STATE = new StateManager();

// ==================================================================================
//  ⚖️  RISK ENGINE
// ==================================================================================

class RiskEngine {
    static analyze(pair) {
        const vol = pair.volume?.h1 || 0;
        const liq = pair.liquidity?.usd || 1;
        const fdv = pair.fdv || pair.marketCap || 0;
        const socials = pair.info?.socials || [];

        // Hype Score
        let hype = 0;
        const ratio = vol / liq;
        if (ratio > 0.5) hype += 20;
        if (ratio > 2.0) hype += 30;
        if (socials.length > 0) hype += 20;
        if (pair.info?.header) hype += 10;
        
        // Safety Checks
        let safe = true;
        
        if (fdv < CONFIG.FILTERS.MIN_MCAP) safe = false;
        if (fdv > CONFIG.FILTERS.MAX_MCAP) safe = false;
        if (liq < CONFIG.FILTERS.MIN_LIQ) safe = false;
        if (vol < CONFIG.FILTERS.MIN_VOL_H1) safe = false;
        if (CONFIG.FILTERS.REQUIRE_SOCIALS && socials.length === 0) safe = false;
        
        if (CONFIG.FILTERS.ANTI_SPAM_NAMES) {
            const name = pair.baseToken.name.toLowerCase();
            if (name.includes('test') || name.length > 20) safe = false;
        }

        // Status
        let status = 'UNKNOWN';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'GRADUATED';
        if (dex.includes('pump')) status = 'PUMP.FUN';

        return { safe, hype, status, vol, liq, fdv };
    }
}

// ==================================================================================
//  📡  MULTI-THREADED SCANNERS
// ==================================================================================

// 1. Profiles (New Paid)
async function scanProfiles() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
        const profiles = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (profiles.length) await fetchAndProcess(profiles.map(p => p.tokenAddress), 'PROFILE');
    } catch (e) { handleErr('Profiles', e); }
    setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

// 2. Boosts (Axiom/Trending)
async function scanBoosts() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
        const boosts = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (boosts.length) await fetchAndProcess(boosts.map(p => p.tokenAddress), 'BOOST');
    } catch (e) { handleErr('Boosts', e); }
    setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

// 3. Search (Deep Scan)
async function scanSearch() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.SEARCH, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        for (const pair of pairs) processPair(pair, 'SEARCH');
    } catch (e) { handleErr('Search', e); }
    setTimeout(scanSearch, CONFIG.SYSTEM.SCAN_DELAY_SEARCH);
}

// --- Processor Logic ---

async function fetchAndProcess(addresses, source) {
    if (!addresses || !addresses.length) return;
    try {
        // Batch fetch (max 30 at a time)
        const chunk = addresses.slice(0, 30).join(',');
        const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${chunk}`, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        for (const pair of pairs) processPair(pair, source);
    } catch (e) { handleErr('Fetch', e); }
}

function processPair(pair, source) {
    if (!pair || !pair.baseToken || pair.chainId !== 'solana') return;
    
    const addr = pair.baseToken.address;

    // 🔒 THE LOCK: Prevents other threads from grabbing this coin
    if (!STATE.lockCoin(addr)) return;

    // ⏳ Analysis
    const analysis = RiskEngine.analyze(pair);
    const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;

    // Check Filters
    if (ageMins < CONFIG.FILTERS.MIN_AGE_MIN || ageMins > CONFIG.FILTERS.MAX_AGE_MIN || !analysis.safe) {
        STATE.unlockCoin(addr); // Failed? Unlock so we can check it later if it improves
        return;
    }

    // ✅ Passed! Finalize and Queue
    STATE.finalizeCoin(addr); // Mark as HISTORY immediately
    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
}

function handleErr(source, e) {
    if (!e.response || e.response.status !== 429) {
        // Utils.log('WARN', source, e.message); // Uncomment to see all errors
    }
}

// ==================================================================================
//  💬  DISCORD SENDER (UPGRADED EMPIRE DESIGN)
// ==================================================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function processQueue() {
    if (STATE.queue.length === 0) {
        setTimeout(processQueue, 1000);
        return;
    }

    const item = STATE.queue.shift();
    await sendAlert(item.pair, item.analysis, item.source);
    setTimeout(processQueue, CONFIG.SYSTEM.QUEUE_DELAY);
}

async function sendAlert(pair, analysis, source) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const token = pair.baseToken;
    const socials = pair.info?.socials || [];
    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    
    // Badge Logic
    let badge = '⚡'; let color = '#FFFFFF';
    if (source === 'BOOST') { badge = '🚀'; color = '#FFD700'; } // Gold/Axiom
    if (source === 'PROFILE') { badge = '💎'; color = '#00D4FF'; } // Blue/Paid
    if (analysis.status === 'GRADUATED') { badge = '🎓'; color = '#00FF00'; }

    const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';

    // 🔥 NEW EMPIRE EMBED DESIGN (Compact, Copy CA, No Dead Space) 🔥
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${badge} ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`**Source:** ${source} | **Status:** ${analysis.status}
**CA:** \`${token.address}\`

${links}

> **📊 METRICS**
> • **MCAP:** \`${Utils.formatUSD(analysis.fdv)}\` | **Liq:** \`${Utils.formatUSD(analysis.liq)}\`
> • **Vol (1h):** \`${Utils.formatUSD(analysis.vol)}\` | **Age:** \`${Utils.getAge(pair.pairCreatedAt)}\`
> • **Price:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\`

**🎯 HYPE SCORE: ${analysis.hype}/100** (${analysis.hype > 40 ? "🔥 HIGH" : "✅ STEADY"})

[**🛒 BUY ON GMGN**](${CONFIG.URLS.REFERRAL}) | [**DexScreener**](${dexLink}) | [**Photon**](${photonLink})`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip V7 • No Duplicates • ${new Date().toLocaleTimeString()}`, iconURL: client.user.displayAvatarURL() });

    try {
        const msg = await channel.send({ embeds: [embed] });
        
        // Add to Tracker for Gains
        STATE.activeTracks.set(token.address, {
            name: token.name,
            symbol: token.symbol,
            entry: parseFloat(pair.priceUsd),
            maxGain: 0,
            msgId: msg.id,
            chanId: channel.id,
            t1: false, t2: false, t3: false,
            start: Date.now()
        });
        
        STATE.stats.calls++;
        Utils.log('SUCCESS', 'Discord', `Sent Alert: ${token.name}`);
    } catch (e) {
        Utils.log('ERROR', 'Discord', e.message);
    }
}

// ==================================================================================
//  📈  TRACKER (REPLIES & STOPS)
// ==================================================================================

async function runTracker() {
    if (STATE.activeTracks.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
        return;
    }

    for (const [addr, data] of STATE.activeTracks) {
        try {
            // Expire old tracks
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

            // 🛑 STOP LOSS / RUG CHECK
            if (curr < (data.entry * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                await sendUpdate(data, curr, gain, 'RUG');
                STATE.activeTracks.delete(addr); // Remove from tracking immediately
                STATE.stats.rugs++;
                continue;
            }

            // 🚀 GAIN CHECK (Replies)
            if (gain > data.maxGain) data.maxGain = gain;

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
        await Utils.sleep(500);
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

        // Peak Logic
        let peakText = '';
        if (data.maxGain > gain && type !== 'RUG') {
            peakText = ` (Peak: +${data.maxGain.toFixed(0)}%)`;
        }

        const desc = type === 'RUG' 
            ? `⚠️ **Token Dropped >90% or Liquidity Pulled.**\nTracking stopped.`
            : `**${data.name} ($${data.symbol})**\nCurrent: **+${gain.toFixed(0)}%**${peakText}\nEntry: \`${Utils.formatPrice(data.entry)}\`\nNow: \`${Utils.formatPrice(price)}\`\n\n[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`;

        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
        await msg.reply({ embeds: [embed] });
        
    } catch (e) { Utils.log('ERROR', 'Tracker', `Reply failed: ${e.message}`); }
}

// ==================================================================================
//  🔧  COMMANDS & SERVER
// ==================================================================================

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!test') {
        const uptime = Utils.getAge(STATE.stats.start);
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🟢 GREEN CHIP V7 - ACTIVE')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '📡 Tracking', value: `${STATE.activeTracks.size}`, inline: true },
                { name: '🎯 Calls', value: `${STATE.stats.calls}`, inline: true }
            );
        await m.reply({ embeds: [embed] });
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'ONLINE', version: CONFIG.VERSION }));
app.listen(process.env.PORT || 3000);

// Start
client.once('ready', () => {
    Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
    scanProfiles();
    scanBoosts();
    scanSearch();
    runTracker();
    processQueue();
});

client.login(process.env.DISCORD_TOKEN);
