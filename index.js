// ==================================================================================
//  🟢 GREEN CHIP V5 "EMPIRE EDITION" - MILITARY GRADE SOLANA TRACKER
//  Multi-Engine Strategy | ATH Peak Tracking | Persistent Leaderboards | Anti-Rug
//  Built for: The Green Chip Empire
//  Architect: Gemini
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==================================================================================
//  ⚙️  EMPIRE CONFIGURATION & STRATEGIES
// ==================================================================================

const CONFIG = {
    // --- System Identity ---
    BOT_NAME: "Green Chip V5",
    VERSION: "5.0.0-EMPIRE",
    EMBED_COLOR: '#00FFA3', // The signature Green Chip neon
    
    // --- File Storage paths ---
    DB_PATH: path.join(__dirname, 'database'),
    
    // --- 6 DISTINCT SEARCH ENGINES (FILTERS) ---
    STRATEGIES: {
        'MICRO_DEGEN': {
            name: "🧨 Micro Degen Snipe",
            minMc: 1000, maxMc: 15000, minVol: 200, minLiq: 500, maxAge: 30, minHype: 8
        },
        'GREEN_CHIP_STD': { // Classic Strategy
            name: "🟢 Green Chip Standard",
            minMc: 20000, maxMc: 60000, minVol: 1000, minLiq: 2000, maxAge: 60, minHype: 15
        },
        'WHALE_VOLUME': {
            name: "🐋 Whale Volume",
            minMc: 50000, maxMc: 150000, minVol: 10000, minLiq: 5000, maxAge: 120, minHype: 25
        },
        'INSIDER_MOVER': {
            name: "🕵️ Insider Mover",
            minMc: 5000, maxMc: 40000, minVol: 500, minLiq: 1000, maxAge: 20, minHype: 20 // Requires high hype relative to size
        },
        'GOLDEN_HOUR': {
            name: "⏳ 1-Hour Sprint",
            minMc: 10000, maxMc: 80000, minVol: 2000, minLiq: 3000, minAge: 45, maxAge: 75, minHype: 12
        },
        'SAFE_HAVEN': {
            name: "🛡️ Safe Entry",
            minMc: 30000, maxMc: 90000, minVol: 3000, minLiq: 8000, maxAge: 240, minHype: 10
        }
    },

    // --- Tracking Mechanics ---
    TRACKING: {
        // Gain Intervals
        ALERTS: [50, 100, 200, 300, 500, 1000, 2000, 5000, 10000], 
        
        // Stop Loss / Rug
        HARD_STOP_LOSS: 0.85,    // 85% drop from entry triggers "CRITICAL LOSS"
        LIQ_WARNING: 1000,       // Liquidity drops below $1k
        
        // Timeouts
        MAX_TRACK_TIME_MS: 24 * 60 * 60 * 1000, // 24 Hours
    },

    // --- Links ---
    URLS: {
        REFERRAL: "https://gmgn.ai/r/Greenchip", // Your ref link
        DEX_URL: "https://dexscreener.com/solana/",
        PHOTON_URL: "https://photon-sol.tinyastro.io/en/lp/"
    }
};

// ==================================================================================
//  💾  DATABASE MANAGER (PERSISTENCE)
// ==================================================================================

class Database {
    constructor() {
        if (!fs.existsSync(CONFIG.DB_PATH)) fs.mkdirSync(CONFIG.DB_PATH);
        
        this.files = {
            active: path.join(CONFIG.DB_PATH, 'active_calls.json'),
            history: path.join(CONFIG.DB_PATH, 'history.json'),
            leaderboard: path.join(CONFIG.DB_PATH, 'leaderboard.json')
        };
        
        this.init();
    }

    init() {
        // Create files if they don't exist
        for (const file of Object.values(this.files)) {
            if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(file.includes('leaderboard') ? { weekly: [], monthly: [] } : []));
        }
    }

    loadActiveCalls() {
        try { return JSON.parse(fs.readFileSync(this.files.active)); } catch { return []; }
    }

    saveActiveCalls(calls) {
        fs.writeFileSync(this.files.active, JSON.stringify(calls, null, 2));
    }

    addToHistory(address) {
        let history = [];
        try { history = JSON.parse(fs.readFileSync(this.files.history)); } catch {}
        history.push({ address, time: Date.now() });
        // Keep history manageable (last 5000)
        if (history.length > 5000) history = history.slice(-5000);
        fs.writeFileSync(this.files.history, JSON.stringify(history));
    }

    checkHistory(address) {
        try {
            const history = JSON.parse(fs.readFileSync(this.files.history));
            return history.some(h => h.address === address);
        } catch { return false; }
    }

    updateLeaderboard(tokenSymbol, gainPct) {
        let lb = { weekly: [], monthly: [] };
        try { lb = JSON.parse(fs.readFileSync(this.files.leaderboard)); } catch {}

        const entry = { symbol: tokenSymbol, gain: gainPct, date: Date.now() };
        
        // Add to both
        lb.weekly.push(entry);
        lb.monthly.push(entry);

        // Sort and Trim
        lb.weekly = lb.weekly.sort((a, b) => b.gain - a.gain).slice(0, 10);
        lb.monthly = lb.monthly.sort((a, b) => b.gain - a.gain).slice(0, 10);

        fs.writeFileSync(this.files.leaderboard, JSON.stringify(lb, null, 2));
    }
    
    getLeaderboard() {
        try { return JSON.parse(fs.readFileSync(this.files.leaderboard)); } catch { return { weekly: [], monthly: [] }; }
    }
}

const DB = new Database();

// ==================================================================================
//  🛠️  UTILITY & FORMATTING
// ==================================================================================

const Utils = {
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    // Aesthetic Number Formatting
    toK: (num) => {
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
        return num.toFixed(0);
    },

    formatPrice: (num) => {
        if (!num) return '$0.00';
        if (num < 0.00001) return '$...'+num.toFixed(10).slice(-5); // Shorten super small nums
        return '$' + num.toFixed(6);
    },

    // Progress Bar Generator
    progressBar: (value, max, size = 10) => {
        const percentage = Math.min(Math.max(value / max, 0), 1);
        const progress = Math.round(size * percentage);
        const emptyProgress = size - progress;
        return '🟩'.repeat(progress) + '⬛'.repeat(emptyProgress);
    },

    getAge: (timestamp) => {
        const mins = Math.floor((Date.now() - timestamp) / 60000);
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        return `${h}h ${mins % 60}m`;
    }
};

// ==================================================================================
//  🎨  DESIGN & EMBED FACTORY (NO DEAD SPACE)
// ==================================================================================

class EmbedFactory {
    
    static createCallEmbed(pair, strategyName, analysis) {
        const token = pair.baseToken;
        const mc = pair.fdv || pair.marketCap;
        
        // Visual Indicators
        const isPumpFun = pair.dexId === 'pump';
        const isRaydium = pair.dexId === 'raydium';
        
        const platformEmoji = isPumpFun ? '<:pump:123456789>' : (isRaydium ? '🪐' : '🦄'); // Replace IDs
        const hypeBar = Utils.progressBar(analysis.score, 30, 8); // Max score assumption 30
        
        const description = `
**CA:** \`${token.address}\`
${platformEmoji} **Strategy:** ${strategyName}
━━━━━━━━━━━━━━━━━━━━━━
**📊 METRICS**
💸 **MC:** \`$${Utils.toK(mc)}\` • **Liq:** \`$${Utils.toK(pair.liquidity?.usd)}\`
📉 **Vol (1h):** \`$${Utils.toK(pair.volume?.h1)}\` • **Age:** \`${Utils.getAge(pair.pairCreatedAt)}\`
🔥 **Hype:** ${hypeBar} \`(${analysis.score}/30)\`

**🧠 INSIGHTS**
${analysis.flags.map(f => `> ${f}`).join('\n')}

**🔗 QUICK LINKS**
[**🦅 GMGN (Snipe)**](${CONFIG.URLS.REFERRAL}) • [**📈 Chart**](${CONFIG.URLS.DEX_URL}${pair.pairAddress}) • [**⚡ Photon**](${CONFIG.URLS.PHOTON_URL}${pair.pairAddress})
━━━━━━━━━━━━━━━━━━━━━━
\`${token.address}\`
`;
        
        return new EmbedBuilder()
            .setColor(CONFIG.EMBED_COLOR)
            .setTitle(`🚀 ${token.name} (${token.symbol})`)
            .setDescription(description)
            .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
            .setFooter({ text: `Green Chip V5 • ${strategyName} • ID: ${pair.pairAddress.slice(0,4)}`, iconURL: 'https://i.imgur.com/placeholder.png' })
            .setTimestamp();
    }

    static createGainEmbed(call, currentPrice, pairData, type) {
        const gainPct = ((currentPrice - call.entryPrice) / call.entryPrice) * 100;
        const peakPct = ((call.peakPrice - call.entryPrice) / call.entryPrice) * 100;
        
        // THE "REALITY" CHECK
        const retrace = peakPct - gainPct;
        const isRetracing = retrace > 20; // If it dropped 20% from peak
        
        let color = '#00FF00';
        let title = `📈 GAIN UPDATE: +${gainPct.toFixed(0)}%`;
        let emoji = '🚀';

        if (type === 'RUG') {
            color = '#FF0000';
            title = '⚠️ STOP LOSS / RUG ALERT';
            emoji = '🚨';
        } else if (gainPct > 100) { color = '#00E5FF'; emoji = '💎'; }
        else if (gainPct > 500) { color = '#FFD700'; emoji = '👑'; }

        // Dynamic Message based on performance
        let statusMsg = "";
        if (type === 'RUG') {
            statusMsg = `**💀 COIN DIED**\nLiquidity Pulled or Price Dumped >85%.`;
        } else if (isRetracing) {
            statusMsg = `**👀 RETRACED FROM PEAK**\nCurrent: **+${gainPct.toFixed(0)}%**\n👑 **PEAK WAS: +${peakPct.toFixed(0)}%** (ATH)`;
        } else {
            statusMsg = `**🔥 NEW ATH HIT!**\nSmashing through targets!`;
        }

        const description = `
${statusMsg}

**ENTRY:** \`${Utils.formatPrice(call.entryPrice)}\`
**CURRENT:** \`${Utils.formatPrice(currentPrice)}\`
**MC:** \`$${Utils.toK(pairData.fdv || pairData.marketCap)}\`

[**💰 TAKE PROFIT HERE**](${CONFIG.URLS.REFERRAL})
`;

        return new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emoji} ${call.symbol}: ${title}`)
            .setDescription(description)
            .setFooter({ text: `Green Chip V5 • Tracking System` });
    }
}

// ==================================================================================
//  🕵️  ANALYSIS ENGINE (MULTI-STRATEGY)
// ==================================================================================

class Analyzer {
    static scan(pair) {
        if (!pair || !pair.baseToken) return null;
        if (pair.chainId !== 'solana') return null;
        if (DB.checkHistory(pair.baseToken.address)) return null;

        const mc = pair.fdv || pair.marketCap || 0;
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h1 || 0;
        const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;
        
        // Determine Hype Score
        let score = 0;
        let flags = [];
        
        if (vol > liq) { score += 10; flags.push("🔥 High Volume/Liq Ratio"); }
        if (pair.info?.socials?.length > 0) { score += 5; } else { flags.push("⚠️ No Socials"); }
        if (pair.info?.websites?.length > 0) { score += 5; }
        if (mc > 30000 && ageMins < 30) { score += 5; flags.push("🐋 Whale Entry Detected"); }
        if (pair.boosts?.active > 0) { score += 5; flags.push("🚀 DexAds Active"); }

        // CHECK AGAINST ALL 6 STRATEGIES
        for (const [key, strat] of Object.entries(CONFIG.STRATEGIES)) {
            if (
                mc >= strat.minMc && mc <= strat.maxMc &&
                liq >= strat.minLiq &&
                vol >= strat.minVol &&
                (strat.minAge ? ageMins >= strat.minAge : true) &&
                ageMins <= strat.maxAge &&
                score >= strat.minHype
            ) {
                return {
                    valid: true,
                    strategyKey: key,
                    strategyName: strat.name,
                    score,
                    flags
                };
            }
        }

        return null;
    }
}

// ==================================================================================
//  🤖  BOT CORE
// ==================================================================================

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
let activeCalls = DB.loadActiveCalls(); // Load from disk on startup

async function broadcastCall(pair, analysis) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const embed = EmbedFactory.createCallEmbed(pair, analysis.strategyName, analysis);
    
    // Add Button for Quick Buy (Simulated Link)
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('🎯 Snipe on GMGN').setStyle(ButtonStyle.Link).setURL(CONFIG.URLS.REFERRAL),
        new ButtonBuilder().setLabel('📊 Chart').setStyle(ButtonStyle.Link).setURL(CONFIG.URLS.DEX_URL + pair.pairAddress)
    );

    const msg = await channel.send({ embeds: [embed], components: [row] });
    
    // Track it
    activeCalls.push({
        address: pair.baseToken.address,
        pairAddress: pair.pairAddress,
        symbol: pair.baseToken.symbol,
        entryPrice: parseFloat(pair.priceUsd),
        peakPrice: parseFloat(pair.priceUsd), // Init peak as entry
        peakGain: 0,
        messageId: msg.id,
        channelId: channel.id,
        startTime: Date.now(),
        nextAlertThreshold: 0 // Index of CONFIG.TRACKING.ALERTS
    });

    DB.saveActiveCalls(activeCalls);
    DB.addToHistory(pair.baseToken.address);
}

async function updateTracker() {
    if (activeCalls.length === 0) return;

    // Filter out old calls
    activeCalls = activeCalls.filter(call => (Date.now() - call.startTime) < CONFIG.TRACKING.MAX_TRACK_TIME_MS);

    for (const call of activeCalls) {
        try {
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${call.address}`, { timeout: 2000 });
            const pair = res.data?.pairs?.find(p => p.pairAddress === call.pairAddress) || res.data?.pairs?.[0];
            
            if (!pair) continue;

            const currentPrice = parseFloat(pair.priceUsd);
            const liq = pair.liquidity?.usd || 0;

            // 1. Calculate Stats
            const gainPct = ((currentPrice - call.entryPrice) / call.entryPrice) * 100;
            
            // 2. Update Peak (ATH)
            if (currentPrice > call.peakPrice) {
                call.peakPrice = currentPrice;
                call.peakGain = gainPct;
            }

            // 3. Check RUG/Stop Loss
            if (currentPrice < (call.entryPrice * CONFIG.TRACKING.HARD_STOP_LOSS) || liq < CONFIG.TRACKING.LIQ_WARNING) {
                const channel = client.channels.cache.get(call.channelId);
                const msg = await channel.messages.fetch(call.messageId);
                await msg.reply({ embeds: [EmbedFactory.createGainEmbed(call, currentPrice, pair, 'RUG')] });
                
                // Remove from active
                activeCalls = activeCalls.filter(c => c.address !== call.address);
                continue;
            }

            // 4. Check Gain Thresholds
            const thresholds = CONFIG.TRACKING.ALERTS;
            // Find the highest threshold we have crossed
            let crossedIndex = -1;
            for(let i=0; i<thresholds.length; i++) {
                if (gainPct >= thresholds[i]) crossedIndex = i;
            }

            // If we crossed a new threshold higher than before
            if (crossedIndex >= call.nextAlertThreshold) {
                const channel = client.channels.cache.get(call.channelId);
                const msg = await channel.messages.fetch(call.messageId);
                await msg.reply({ embeds: [EmbedFactory.createGainEmbed(call, currentPrice, pair, 'GAIN')] });
                
                call.nextAlertThreshold = crossedIndex + 1; // Wait for next level
                
                // Update Leaderboard if it's a big win
                if (gainPct > 100) DB.updateLeaderboard(call.symbol, gainPct);
            }

        } catch (e) { console.error(`Tracker Error [${call.symbol}]:`, e.message); }
        
        await Utils.sleep(1000); // Rate limit protection
    }
    
    DB.saveActiveCalls(activeCalls);
}

// ==================================================================================
//  🔄  MAIN LOOP
// ==================================================================================

async function scannerLoop() {
    try {
        // Fetch new pairs
        const res = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana', { timeout: 5000 });
        const pairs = res.data?.pairs || [];

        for (const pair of pairs) {
            const analysis = Analyzer.scan(pair);
            if (analysis && analysis.valid) {
                console.log(`[FOUND] ${pair.baseToken.symbol} via ${analysis.strategyName}`);
                await broadcastCall(pair, analysis);
                await Utils.sleep(2000); // Delay between multiple finds
            }
        }
    } catch (e) {
        console.error("Scanner API Error:", e.message);
    }
    
    setTimeout(scannerLoop, 10000); // Run every 10 seconds
}

// ==================================================================================
//  📊  LEADERBOARD COMMANDS
// ==================================================================================

client.on('messageCreate', async (message) => {
    if (message.content === '!stats' || message.content === '!lb') {
        const lb = DB.getLeaderboard();
        
        const formatLB = (list) => list.length ? list.map((e, i) => `\`#${i+1}\` **${e.symbol}** • +${e.gain.toFixed(0)}%`).join('\n') : "No data yet.";

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🏆 GREEN CHIP CHAMPIONS')
            .addFields(
                { name: '📅 THIS WEEK', value: formatLB(lb.weekly), inline: true },
                { name: '🗓️ THIS MONTH', value: formatLB(lb.monthly), inline: true }
            );
            
        message.reply({ embeds: [embed] });
    }
});

// ==================================================================================
//  📡  SERVER & START
// ==================================================================================

const app = express();
app.get('/', (req, res) => res.send(`Green Chip V5 Active. Monitoring ${activeCalls.length} coins.`));
app.listen(process.env.PORT || 3000);

client.once('ready', () => {
    console.log(`✅ ${CONFIG.BOT_NAME} ONLINE`);
    console.log(`✅ Loaded ${Object.keys(CONFIG.STRATEGIES).length} Search Engines`);
    scannerLoop();
    setInterval(updateTracker, 15000); // Check gains every 15s
});

client.login(process.env.DISCORD_TOKEN);
