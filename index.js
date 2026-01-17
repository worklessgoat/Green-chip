// ==================================================================================
//  🟢 GREEN CHIP V8.2 - COMPACT CARD EDITION
//  ---------------------------------------------------------------------------------
//  New Capabilities:
//  [1] 🖼️ COMPACT GAINS: Uses a "Banner Style" image for the "Small Space" look.
//  [2] 📅 LEADERBOARDS: Daily, Weekly, and Monthly Auto-Recaps.
//  [3] 🎨 DYNAMIC UI: Risk-based colors & Banner support.
//  [4] 📋 COPY CA: One-click button to copy Contract Address.
//  [5] 📈 REAL GAINS: Market Cap based calculations & Peak detection.
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone'); // REQUIRE: npm install moment-timezone

// 🟢 CONFIGURATION: Set Timezone to US Eastern (New York)
moment.tz.setDefault("America/New_York");

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V8",
    VERSION: "8.2.0-COMPACT",
    
    // --- Strategy Filters ---
    FILTERS: {
        MIN_MCAP: 20000,         // $20k Minimum
        MAX_MCAP: 75000,         
        MIN_LIQ: 1500,           
        MIN_VOL_H1: 500,         
        MAX_AGE_MIN: 60,         
        MIN_AGE_MIN: 1,          
        REQUIRE_SOCIALS: true,   
        ANTI_SPAM_NAMES: true    
    },

    // --- Tracking Logic ---
    TRACKER: {
        GAIN_TRIGGER_1: 45,      // +45% Gain
        GAIN_TRIGGER_2: 100,     // +100% Gain
        GAIN_TRIGGER_3: 500,     // +500% Gain
        STOP_LOSS: 0.90,         
        RUG_CHECK_LIQ: 300,      
        MAX_HOURS: 24            
    },

    // --- System Intervals ---
    SYSTEM: {
        SCAN_DELAY_PROFILES: 15000,  
        SCAN_DELAY_BOOSTS: 30000,    
        SCAN_DELAY_SEARCH: 60000,    
        TRACK_DELAY: 15000,          
        QUEUE_DELAY: 3000,           
        DAILY_CHECK_INTERVAL: 60000  
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
        const t = moment().format('h:mm:ss A'); 
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', DAILY: '📅' };
        console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
    }
};

// ==================================================================================
//  🧠  MEMORY & STATE
// ==================================================================================

class StateManager {
    constructor() {
        this.activeTracks = new Map();     
        this.history = new Set();          
        this.processing = new Set();       
        this.queue = [];                   
        
        this.dailyStats = new Map();       
        this.weeklyStats = new Map();
        this.monthlyStats = new Map();
        
        this.lastDailyReport = null;
        this.lastWeeklyReport = null;
        this.lastMonthlyReport = null;
        
        this.stats = { calls: 0, rugs: 0, start: Date.now() };
    }

    lockCoin(address) {
        if (this.history.has(address)) return false;
        if (this.processing.has(address)) return false;
        this.processing.add(address);
        return true;
    }

    unlockCoin(address) {
        this.processing.delete(address);
    }

    finalizeCoin(address, data) {
        this.processing.delete(address);
        this.history.add(address);
        
        const statEntry = {
            name: data.name,
            symbol: data.symbol,
            entryMcap: data.mcap, 
            maxGain: 0,
            time: Date.now(),
            status: 'ACTIVE'
        };

        this.dailyStats.set(address, { ...statEntry });
        this.weeklyStats.set(address, { ...statEntry });
        this.monthlyStats.set(address, { ...statEntry });

        if (this.history.size > 10000) {
            const it = this.history.values();
            this.history.delete(it.next().value);
        }
    }

    updatePeak(address, gain, status = 'ACTIVE') {
        const updateMap = (map) => {
            if (map.has(address)) {
                const stat = map.get(address);
                if (gain > stat.maxGain) stat.maxGain = gain;
                stat.status = status;
                map.set(address, stat);
            }
        };

        updateMap(this.dailyStats);
        updateMap(this.weeklyStats);
        updateMap(this.monthlyStats);
    }
}

const STATE = new StateManager();

// ==================================================================================
//  ⚖️  RISK ENGINE (COLOR LOGIC)
// ==================================================================================

class RiskEngine {
    static analyze(pair) {
        const vol = pair.volume?.h1 || 0;
        const liq = pair.liquidity?.usd || 1;
        const fdv = pair.fdv || pair.marketCap || 0;
        const socials = pair.info?.socials || [];

        let hype = 0;
        const ratio = vol / liq;
        if (ratio > 0.5) hype += 20;
        if (ratio > 2.0) hype += 30;
        if (socials.length > 0) hype += 20;
        if (pair.info?.header) hype += 10;
        
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

        // --- Risk Colors ---
        let riskLevel = 'YELLOW'; 
        let color = '#FFFF00'; 

        if (liq < 4000 || fdv < 25000) {
            riskLevel = 'RED';
            color = '#FF0000'; 
        } 
        else if (liq > 8000 && fdv > 40000 && socials.length > 0) {
            riskLevel = 'GREEN';
            color = '#00FF00'; 
        }

        let status = 'UNKNOWN';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'GRADUATED';
        if (dex.includes('pump')) status = 'PUMP.FUN';

        return { safe, hype, status, vol, liq, fdv, riskLevel, color };
    }
}

// ==================================================================================
//  📡  SCANNERS
// ==================================================================================

async function scanProfiles() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
        const profiles = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (profiles.length) await fetchAndProcess(profiles.map(p => p.tokenAddress), 'PROFILE');
    } catch (e) { handleErr('Profiles', e); }
    setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

async function scanBoosts() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
        const boosts = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (boosts.length) await fetchAndProcess(boosts.map(p => p.tokenAddress), 'BOOST');
    } catch (e) { handleErr('Boosts', e); }
    setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

async function scanSearch() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.SEARCH, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        for (const pair of pairs) processPair(pair, 'SEARCH');
    } catch (e) { handleErr('Search', e); }
    setTimeout(scanSearch, CONFIG.SYSTEM.SCAN_DELAY_SEARCH);
}

async function fetchAndProcess(addresses, source) {
    if (!addresses || !addresses.length) return;
    try {
        const chunk = addresses.slice(0, 30).join(',');
        const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${chunk}`, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        for (const pair of pairs) processPair(pair, source);
    } catch (e) { handleErr('Fetch', e); }
}

function processPair(pair, source) {
    if (!pair || !pair.baseToken || pair.chainId !== 'solana') return;
    const addr = pair.baseToken.address;

    if (!STATE.lockCoin(addr)) return;

    const analysis = RiskEngine.analyze(pair);
    const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;

    if (ageMins < CONFIG.FILTERS.MIN_AGE_MIN || ageMins > CONFIG.FILTERS.MAX_AGE_MIN || !analysis.safe) {
        STATE.unlockCoin(addr);
        return;
    }

    STATE.finalizeCoin(addr, { 
        name: pair.baseToken.name, 
        symbol: pair.baseToken.symbol, 
        price: parseFloat(pair.priceUsd),
        mcap: analysis.fdv 
    });
    
    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
}

function handleErr(source, e) {}

// ==================================================================================
//  💬  DISCORD SENDER
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
    
    const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';
    const banner = pair.info?.header || null; 
    const icon = pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';

    const embed = new EmbedBuilder()
        .setColor(analysis.color) // 🔴 🟡 🟢 Dynamic Color
        .setTitle(`${analysis.riskLevel === 'GREEN' ? '🟢' : analysis.riskLevel === 'RED' ? '🔴' : '🟡'} ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
**Source:** ${source} | **Risk:** ${analysis.riskLevel}

${links}

> **📊 DATA**
> • **MCAP:** \`${Utils.formatUSD(analysis.fdv)}\`
> • **Liquidity:** \`${Utils.formatUSD(analysis.liq)}\`
> • **Volume:** \`${Utils.formatUSD(analysis.vol)}\`

**🎯 HYPE: ${analysis.hype}/100**
${analysis.hype > 40 ? "🔥 HIGH MOMENTUM" : "✅ STEADY"}

[**🛒 BUY ON GMGN**](${CONFIG.URLS.REFERRAL})
`)
        .setThumbnail(icon)
        .setImage(banner) 
        .setFooter({ text: `Green Chip V8 • ${moment().format('h:mm A')} EST`, iconURL: client.user.displayAvatarURL() });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`copy_${token.address}`)
                .setLabel('📋 Copy CA')
                .setStyle(ButtonStyle.Secondary)
        );

    try {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        
        STATE.activeTracks.set(token.address, {
            name: token.name,
            symbol: token.symbol,
            entryMcap: analysis.fdv, 
            entryPrice: parseFloat(pair.priceUsd),
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
//  📅  LEADERBOARD SYSTEM
// ==================================================================================

function initScheduler() {
    setInterval(async () => {
        const now = moment();
        const dateStr = now.format("YYYY-MM-DD");
        
        if (now.hour() === 0 && now.minute() === 0) {
            
            if (STATE.lastDailyReport !== dateStr) {
                await sendLeaderboard('DAILY', STATE.dailyStats);
                STATE.lastDailyReport = dateStr;
                STATE.dailyStats.clear();
            }

            if (now.day() === 1 && STATE.lastWeeklyReport !== dateStr) {
                await sendLeaderboard('WEEKLY', STATE.weeklyStats);
                STATE.lastWeeklyReport = dateStr;
                STATE.weeklyStats.clear();
            }

            if (now.date() === 1 && STATE.lastMonthlyReport !== dateStr) {
                await sendLeaderboard('MONTHLY', STATE.monthlyStats);
                STATE.lastMonthlyReport = dateStr;
                STATE.monthlyStats.clear();
            }
        }
    }, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendLeaderboard(type, statMap) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const allCalls = Array.from(statMap.values());
    const sorted = allCalls.sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);

    if (sorted.length === 0) return;

    let desc = `**Top Performers for ${type}**\n\n`;

    sorted.forEach((coin, index) => {
        let icon = '🟢';
        if (coin.maxGain > 100) icon = '🚀';
        if (coin.maxGain > 500) icon = '👑';
        if (coin.status === 'RUG') icon = '💀';

        desc += `**#${index + 1} ${icon} ${coin.name} ($${coin.symbol})**\n`;
        desc += `Peak: **+${coin.maxGain.toFixed(0)}%**\n`;
        desc += `Status: ${coin.status}\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 GREEN CHIP ${type} LEADERBOARD`)
        .setDescription(desc)
        .setTimestamp()
        .setFooter({ text: 'Green Chip V8 • Leaderboard' });

    await channel.send({ embeds: [embed] });
}

// ==================================================================================
//  📈  TRACKER (COMPACT GAINS CARD)
// ==================================================================================

async function runTracker() {
    if (STATE.activeTracks.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
        return;
    }

    for (const [addr, data] of STATE.activeTracks) {
        try {
            if (Date.now() - data.start > (CONFIG.TRACKER.MAX_HOURS * 3600000)) {
                STATE.activeTracks.delete(addr);
                continue;
            }

            const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${addr}`, { timeout: 3000, headers: Utils.getHeaders() });
            const pair = res.data?.pairs?.[0];
            if (!pair) continue;

            const currPrice = parseFloat(pair.priceUsd);
            const currMcap = pair.fdv || pair.marketCap;
            const liq = pair.liquidity?.usd || 0;

            const gain = ((currMcap - data.entryMcap) / data.entryMcap) * 100;
            STATE.updatePeak(addr, gain, 'ACTIVE');

            if (currPrice < (data.entryPrice * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                STATE.updatePeak(addr, gain, 'RUG');
                STATE.activeTracks.delete(addr);
                continue;
            }

            if (gain > data.maxGain) data.maxGain = gain;

            if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) {
                await sendUpdate(data, currMcap, gain, 'GAIN');
                data.t1 = true;
            } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_2 && !data.t2) {
                await sendUpdate(data, currMcap, gain, 'MOON');
                data.t2 = true;
            } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_3 && !data.t3) {
                await sendUpdate(data, currMcap, gain, 'GOD');
                data.t3 = true;
            }

        } catch (e) {}
        await Utils.sleep(500);
    }
    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
}

async function sendUpdate(data, currentMcap, gain, type) {
    const channel = client.channels.cache.get(data.chanId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(data.msgId);
        if (!msg) return;

        let color = '#00FF00'; let title = `🚀 GAIN: +${gain.toFixed(0)}%`;
        if (type === 'MOON') { color = '#00D4FF'; title = `🌕 MOONSHOT: +${gain.toFixed(0)}%`; }
        if (type === 'GOD') { color = '#FFD700'; title = `👑 GOD CANDLE: +${gain.toFixed(0)}%`; }

        // Use Placehold.co to create a perfectly sized "Banner" (600x200)
        // This forces Discord to render it as a small card at the bottom.
        const bannerText = `GAIN +${gain.toFixed(0)}% | ${Utils.formatUSD(currentMcap)}`;
        const bannerUrl = `https://placehold.co/600x200/00b140/ffffff/png?text=${encodeURIComponent(bannerText)}&font=roboto`;

        const desc = `**${data.name} ($${data.symbol})**\n` +
            `Entry: \`${Utils.formatUSD(data.entryMcap)}\`\n` +
            `Current: \`${Utils.formatUSD(currentMcap)}\`\n` +
            `[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`;

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(desc)
            .setImage(bannerUrl) // 👈 THIS IS THE SMALL SPACE IMAGE
            .setTimestamp();
            
        await msg.reply({ embeds: [embed] });
        
    } catch (e) { Utils.log('ERROR', 'Tracker', `Reply failed: ${e.message}`); }
}

// ==================================================================================
//  🔧  INTERACTION HANDLER
// ==================================================================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId.startsWith('copy_')) {
        const ca = interaction.customId.split('_')[1];
        await interaction.reply({ 
            content: `${ca}`, 
            ephemeral: true 
        });
    }
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!test') {
        await m.reply(`🟢 Green Chip Online | ${moment().format('YYYY-MM-DD h:mm A z')}`);
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'ONLINE', version: CONFIG.VERSION }));
app.listen(process.env.PORT || 3000);

client.once('ready', () => {
    Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
    scanProfiles();
    scanBoosts();
    scanSearch();
    runTracker();
    processQueue();
    initScheduler();
});

client.login(process.env.DISCORD_TOKEN);
