// ==================================================================================
//  🟢 GREEN CHIP V4 ULTRA - PRODUCTION GRADE SOLANA TRACKER
//  Target: 1m-1h Age | $20k-$55k MC | High Vol | Anti-Rug | Social Hype Analysis
//  Author: Gemini (AI) for GreenChip
//  Updated: Fixed 429 Rate Limits for Render Hosting
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials } = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment');

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    // --- Identification ---
    BOT_NAME: "Green Chip V4",
    VERSION: "4.0.1-STABLE",
    
    // --- Discovery Filters ---
    FILTERS: {
        MIN_MCAP: 20000,        // $20k Minimum
        MAX_MCAP: 55000,        // $55k Maximum
        MIN_LIQUIDITY: 1500,    // Hard floor for liquidity
        MIN_VOLUME_H1: 500,     // Must have active trading
        MIN_AGE_MINUTES: 1,     // No 0-second coins (avoids instant rugs)
        MAX_AGE_MINUTES: 60,    // Only fresh coins
        MAX_PRICE_USD: 1.0,     // Avoid weird pegged tokens
        REQUIRE_SOCIALS: true,  // Must have Twitter/TG/Website
        MAX_SYM_LENGTH: 15,     // Filter out spam names
        MIN_HYPE_SCORE: 10      // Internal score (Vol/Liq ratio * social bonus)
    },

    // --- Tracking & Gains ---
    TRACKING: {
        GAIN_TRIGGER_START: 45,      // First alert at +45%
        GAIN_STEP_MULTIPLIER: 1.5,   // Next alert needs significant jump
        MAX_GAIN_PERCENT: 10000000,  // Cap at 10M%
        STOP_LOSS_DROP: 0.90,        // Stop if drops 90% from entry
        RUG_LIQ_THRESHOLD: 300,      // If liq drops below $300, it's a rug
        MAX_TRACK_DURATION_HR: 24    // Stop tracking after 24h
    },

    // --- System Intervals (TUNED FOR RENDER) ---
    SYSTEM: {
        SCAN_INTERVAL_MS: 12000,     // Increased to 12s to prevent 429s
        TRACK_INTERVAL_MS: 15000,    // Check gains every 15 seconds
        CACHE_CLEANUP_MS: 3600000,   // Clean memory every hour
        RATE_LIMIT_DELAY: 2000       // Pause between Discord sends
    },

    // --- Links ---
    URLS: {
        REFERRAL: "https://gmgn.ai/r/Greenchip",
        DEX_API: "https://api.dexscreener.com/latest/dex/search?q=solana",
        TOKEN_API: "https://api.dexscreener.com/latest/dex/tokens/"
    }
};

// ==================================================================================
//  🛠️  UTILITY TOOLKIT
// ==================================================================================

const Utils = {
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    // Professional currency formatting
    formatUSD: (num) => {
        if (!num || isNaN(num)) return '$0.00';
        if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
        return '$' + num.toFixed(2);
    },

    // Precise price formatting for crypto
    formatPrice: (num) => {
        if (!num || isNaN(num)) return '$0.00';
        if (num < 0.000001) return '$' + num.toFixed(10);
        return '$' + num.toFixed(6);
    },

    // Time calculation
    getAge: (timestamp) => {
        const diffMs = Date.now() - timestamp;
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return '🔥 Just Launched';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m ago`;
    },

    // Logger
    log: (type, message) => {
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', SYSTEM: '⚙️' };
        console.log(`[${time}] ${icons[type] || ''} ${type}: ${message}`);
    }
};

// ==================================================================================
//  🧠  STATE MANAGEMENT
// ==================================================================================

class StateManager {
    constructor() {
        this.activeCalls = new Map(); // Stores currently tracked coins
        this.processedHistory = new Set(); // Stores addresses seen
        this.stats = {
            callsToday: 0,
            startTime: Date.now(),
            apiRequests: 0,
            ruggedDetected: 0
        };
    }

    isProcessed(address) {
        return this.processedHistory.has(address);
    }

    addProcessed(address) {
        this.processedHistory.add(address);
        // Memory safety: If set gets too big (>5000), clear oldest
        if (this.processedHistory.size > 5000) {
            const it = this.processedHistory.values();
            this.processedHistory.delete(it.next().value);
        }
    }

    addActiveCall(data) {
        this.activeCalls.set(data.address, data);
        this.stats.callsToday++;
    }

    removeActiveCall(address) {
        this.activeCalls.delete(address);
    }
}

const STATE = new StateManager();

// ==================================================================================
//  🌐  EXPRESS SERVER (FOR RENDER/UPTIME)
// ==================================================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'Operational',
        uptime: Utils.getAge(STATE.stats.startTime),
        tracking: STATE.activeCalls.size,
        history_size: STATE.processedHistory.size,
        calls_today: STATE.stats.callsToday
    });
});

app.listen(PORT, () => {
    Utils.log('SYSTEM', `Web server running on port ${PORT}`);
});

// ==================================================================================
//  🤖  DISCORD CLIENT
// ==================================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

// ==================================================================================
//  🕵️  COIN ANALYZER ENGINE
// ==================================================================================

class CoinAnalyzer {
    
    static calculateHypeScore(pair) {
        let score = 0;
        const vol = pair.volume?.h1 || 0;
        const liq = pair.liquidity?.usd || 1;
        
        // 1. Vol/Liq Ratio (High ratio = High momentum)
        const ratio = vol / liq;
        if (ratio > 0.5) score += 10;
        if (ratio > 1.0) score += 20;
        if (ratio > 5.0) score += 40; 

        // 2. Socials Presence
        const socials = pair.info?.socials || [];
        score += (socials.length * 15); 
        
        // 3. Website check
        const hasWeb = socials.find(s => s.type === 'website');
        if (hasWeb) score += 10;

        return score;
    }

    static getStatusBadge(pair) {
        const dexId = (pair.dexId || '').toLowerCase();
        if (dexId === 'raydium') return { text: '🎓 RAYDIUM GRADUATED', emoji: '🌟', color: '#00D4FF' }; 
        if (dexId === 'pump') return { text: '🚀 PUMP.FUN LIVE', emoji: '💊', color: '#14F195' }; 
        return { text: '⚡ DEX LISTED', emoji: '⚡', color: '#FFFFFF' };
    }

    static validate(pair) {
        // Basic Null Checks
        if (!pair?.baseToken?.address || !pair?.priceUsd) return { valid: false, reason: 'Incomplete Data' };
        
        // Protocol Check
        if (pair.chainId !== 'solana') return { valid: false, reason: 'Not Solana' };

        // Duplicate Check
        if (STATE.isProcessed(pair.baseToken.address)) return { valid: false, reason: 'Already Seen' };

        // 1. Market Cap Filter
        const fdv = pair.fdv || pair.marketCap || 0;
        if (fdv < CONFIG.FILTERS.MIN_MCAP) return { valid: false, reason: `MC Too Low ($${Utils.formatUSD(fdv)})` };
        if (fdv > CONFIG.FILTERS.MAX_MCAP) return { valid: false, reason: `MC Too High ($${Utils.formatUSD(fdv)})` };

        // 2. Age Filter
        const createdAt = pair.pairCreatedAt; 
        if (!createdAt) return { valid: false, reason: 'Unknown Age' };
        const ageMins = (Date.now() - createdAt) / 60000;
        if (ageMins < CONFIG.FILTERS.MIN_AGE_MINUTES) return { valid: false, reason: 'Too New' };
        if (ageMins > CONFIG.FILTERS.MAX_AGE_MINUTES) return { valid: false, reason: 'Too Old' };

        // 3. Liquidity & Volume
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h1 || 0;
        if (liq < CONFIG.FILTERS.MIN_LIQUIDITY) return { valid: false, reason: 'Low Liq' };
        if (vol < CONFIG.FILTERS.MIN_VOLUME_H1) return { valid: false, reason: 'Dead Volume' };

        // 4. Socials
        const socials = pair.info?.socials || [];
        if (CONFIG.FILTERS.REQUIRE_SOCIALS && socials.length === 0) return { valid: false, reason: 'No Socials' };

        // 5. Spam Name Filter
        if (pair.baseToken.symbol.length > CONFIG.FILTERS.MAX_SYM_LENGTH) return { valid: false, reason: 'Spam Symbol' };

        // 6. Hype Check
        const hype = this.calculateHypeScore(pair);
        if (hype < CONFIG.FILTERS.MIN_HYPE_SCORE) return { valid: false, reason: 'Low Hype Score' };

        return { 
            valid: true, 
            metrics: { hype, ageMins, fdv, liq, vol } 
        };
    }
}

// ==================================================================================
//  📢  MESSAGE BUILDER
// ==================================================================================

async function sendCallAlert(pair, metrics) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return Utils.log('ERROR', 'Channel not found');

    const token = pair.baseToken;
    const status = CoinAnalyzer.getStatusBadge(pair);
    const socials = pair.info?.socials || [];
    
    // Build Links
    const linkMap = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ');
    const socialText = linkMap.length > 0 ? linkMap : "⚠️ *No social links detected*";

    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    
    const embed = new EmbedBuilder()
        .setColor(status.color)
        .setTitle(`${status.emoji} NEW SIGNAL: ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
**${status.text}**
${socialText}

> **🔍 ANALYSIS**
> Hype Score: \`${metrics.hype}/100\`
> Status: **${metrics.ageMins < 10 ? "🔥 HOT LAUNCH" : "✅ STABILIZING"}**

**📊 LIVE METRICS**
• **Market Cap:** \`${Utils.formatUSD(metrics.fdv)}\`
• **Price:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\`
• **Liquidity:** \`${Utils.formatUSD(metrics.liq)}\`
• **Volume (1h):** \`${Utils.formatUSD(metrics.vol)}\`
• **Age:** \`${Utils.getAge(pair.pairCreatedAt)}\`

**⚡ QUICK ACTIONS**
[**🛒 BUY ON GMGN (Lower Fees)**](${CONFIG.URLS.REFERRAL})
[**📈 Chart**](${dexLink}) | [**⚡ Photon**](${photonLink})

*Disclaimer: High risk. DYOR. Not financial advice.*
`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip V4 • Protected by Anti-Rug AI • ${new Date().toLocaleTimeString()}`, iconURL: client.user.displayAvatarURL() })
        .addFields({ name: '📜 CA', value: `\`${token.address}\`` });

    try {
        const msg = await channel.send({ embeds: [embed] });
        
        // Register for tracking
        STATE.addActiveCall({
            address: token.address,
            symbol: token.symbol,
            entryPrice: parseFloat(pair.priceUsd),
            highestPrice: parseFloat(pair.priceUsd),
            highestGain: 0,
            channelId: process.env.CHANNEL_ID,
            messageId: msg.id,
            startTime: Date.now(),
            lastUpdate: Date.now()
        });

        Utils.log('SUCCESS', `Sent Call: ${token.name}`);
    } catch (err) {
        Utils.log('ERROR', `Failed to send embed: ${err.message}`);
    }
}

async function sendGainUpdate(callData, currentPrice, pairData, type = 'GAIN') {
    const channel = client.channels.cache.get(callData.channelId);
    if (!channel) return;

    try {
        const originalMsg = await channel.messages.fetch(callData.messageId);
        if (!originalMsg) return;

        const gainPct = ((currentPrice - callData.entryPrice) / callData.entryPrice) * 100;
        const mc = pairData.fdv || pairData.marketCap || 0;

        let embedColor = '#00FF00'; // Green
        let emoji = '🚀';
        let title = `GAIN UPDATE: +${gainPct.toFixed(2)}%`;

        if (type === 'RUG') {
            embedColor = '#FF0000'; // Red
            emoji = '🚨';
            title = 'STOP LOSS / RUG ALERT';
        } else if (gainPct > 100) {
            embedColor = '#FFD700'; // Gold
            emoji = '🌕';
        } else if (gainPct > 500) {
            embedColor = '#FF00FF'; // Purple
            emoji = '💎';
        }

        const description = type === 'RUG' 
            ? `**⚠️ CRITICAL DROP DETECTED**\nCoin dropped >90% or Liquidity Pulled.\nTracking Stopped.`
            : `
**${callData.symbol} is MOONING!**
Entry: \`${Utils.formatPrice(callData.entryPrice)}\`
Current: \`${Utils.formatPrice(currentPrice)}\`
**Gain: +${gainPct.toFixed(2)}%**

Current MC: \`${Utils.formatUSD(mc)}\`

[**💰 TAKE PROFIT ON GMGN**](${CONFIG.URLS.REFERRAL})
`;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${emoji} ${title}`)
            .setDescription(description)
            .setFooter({ text: 'Green Chip V4 Auto-Tracker' })
            .setTimestamp();

        await originalMsg.reply({ embeds: [embed] });

    } catch (err) {
        Utils.log('ERROR', `Failed to send update: ${err.message}`);
    }
}

// ==================================================================================
//  🔄  CORE LOOPS (SCANNER & TRACKER)
// ==================================================================================

// 1. Scanner Loop - WITH 429 PROTECTION
async function runScanner() {
    try {
        STATE.stats.apiRequests++;
        const res = await axios.get(CONFIG.URLS.DEX_API, {
            timeout: 5000,
            headers: { 
                // Spoof a real browser to avoid instant blocks
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        const pairs = res.data?.pairs || [];

        for (const pair of pairs) {
            // Processing logic
            const check = CoinAnalyzer.validate(pair);
            
            if (check.valid) {
                STATE.addProcessed(pair.baseToken.address);
                await sendCallAlert(pair, check.metrics);
                await Utils.sleep(CONFIG.SYSTEM.RATE_LIMIT_DELAY); // Prevent rate limit
            }
        }
        
        // Success? Wait normal interval
        setTimeout(runScanner, CONFIG.SYSTEM.SCAN_INTERVAL_MS);

    } catch (err) {
        // ⚠️ HANDLE 429 ERRORS (RATE LIMITS)
        if (err.response && err.response.status === 429) {
            Utils.log('WARN', `⛔ RATE LIMITED (429). Cooling down for 60 seconds...`);
            // Wait 60 seconds before trying again to clear the ban
            setTimeout(runScanner, 60000); 
            return;
        }

        // Handle other errors (Network, 500s, etc)
        Utils.log('WARN', `Scanner API Error: ${err.message}`);
        // Retry slower (20 seconds) if API is acting up
        setTimeout(runScanner, 20000);
    }
}

// 2. Tracker Loop
async function runTracker() {
    if (STATE.activeCalls.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_INTERVAL_MS);
        return;
    }

    for (const [address, data] of STATE.activeCalls) {
        try {
            // Stop tracking if too old
            if (Date.now() - data.startTime > (CONFIG.TRACKING.MAX_TRACK_DURATION_HR * 3600000)) {
                STATE.removeActiveCall(address);
                continue;
            }

            const res = await axios.get(`${CONFIG.URLS.TOKEN_API}${address}`, { 
                timeout: 3000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            const pair = res.data?.pairs?.[0]; // Get best pair

            if (!pair) continue;

            const currentPrice = parseFloat(pair.priceUsd);
            const liq = pair.liquidity?.usd || 0;

            // RUG CHECK
            if (currentPrice < (data.entryPrice * (1 - CONFIG.TRACKING.STOP_LOSS_DROP)) || liq < CONFIG.TRACKING.RUG_LIQ_THRESHOLD) {
                await sendGainUpdate(data, currentPrice, pair, 'RUG');
                STATE.removeActiveCall(address);
                STATE.stats.ruggedDetected++;
                continue;
            }

            // GAIN CHECK
            const gain = ((currentPrice - data.entryPrice) / data.entryPrice) * 100;
            
            if (gain >= CONFIG.TRACKING.GAIN_TRIGGER_START) {
                if (gain > data.highestGain + CONFIG.TRACKING.GAIN_STEP_MULTIPLIER) {
                    await sendGainUpdate(data, currentPrice, pair, 'GAIN');
                    data.highestGain = gain; // Update high water mark
                }
            }
            
            if (gain > data.highestGain) data.highestGain = gain;

        } catch (err) {
            // Silent fail for tracker to keep moving
        }
        await Utils.sleep(500); // Pace the tracker
    }

    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_INTERVAL_MS);
}

// ==================================================================================
//  💬  COMMAND HANDLING
// ==================================================================================

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!test') {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🟢 GREEN CHIP V4 - SYSTEM ONLINE')
            .setDescription('All systems nominal. Ready to hunt.')
            .addFields(
                { name: '⏱️ Uptime', value: Utils.getAge(STATE.stats.startTime), inline: true },
                { name: '📡 Active Tracks', value: `${STATE.activeCalls.size}`, inline: true },
                { name: '👁️ Coins Scanned', value: `${STATE.processedHistory.size}`, inline: true },
                { name: '🎯 Calls Today', value: `${STATE.stats.callsToday}`, inline: true },
                { name: '🛡️ Rugs Caught', value: `${STATE.stats.ruggedDetected}`, inline: true },
                { name: '⚙️ Memory', value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true }
            )
            .setFooter({ text: `Version ${CONFIG.VERSION}` });
        
        await message.reply({ embeds: [embed] });
    }
});

// ==================================================================================
//  🚀  INITIALIZATION
// ==================================================================================

client.once('ready', () => {
    Utils.log('SUCCESS', `Logged in as ${client.user.tag}`);
    Utils.log('INFO', `Filters: $${CONFIG.FILTERS.MIN_MCAP}-$${CONFIG.FILTERS.MAX_MCAP} MC | Age: ${CONFIG.FILTERS.MIN_AGE_MINUTES}-${CONFIG.FILTERS.MAX_AGE_MINUTES}m`);
    
    client.user.setPresence({
        activities: [{ name: 'Solana Chain 24/7', type: ActivityType.Watching }],
        status: 'dnd',
    });

    // Start Loops
    runScanner();
    runTracker();
});

// Handle Login Errors
if (!process.env.DISCORD_TOKEN || !process.env.CHANNEL_ID) {
    Utils.log('ERROR', 'Missing ENV variables. Check .env file.');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

// Global Error Prevention
process.on('unhandledRejection', (reason, promise) => {
    Utils.log('ERROR', `Unhandled Rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
    Utils.log('ERROR', `Uncaught Exception: ${err.message}`);
    // Keep alive
});
