// ==================================================================================
//  🟢 GREEN CHIP V9 "LEGACY" - ENTERPRISE TRADING ENGINE
//  ---------------------------------------------------------------------------------
//  Core Capabilities:
//  [1] 📡 TRI-SOURCE SCANNER: Restored V8 Profiles + Boosts + Search mechanism.
//  [2] 💾 PERSISTENCE: Auto-saves data to 'database.json'. No data loss on restart.
//  [3] 📅 MULTI-TIMEFRAME: Tracks Daily, Weekly, and Monthly highest gains.
//  [4] 🏆 LEADERBOARD CMDS: Use !top, !top week, !top month for live standings.
//  [5] 🤖 AUTO-REPORTS: Auto-posts Daily (Midnight), Weekly (Sunday), Monthly (1st).
//  [6] 📱 RICK-STYLE UI: Vertical, clean, compact alerts with no dead space.
//  [7] 📈 LIVE STATUS: Bot displays real-time SOL price in status.
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
//  Version: 9.1.0-RESORED-SCANNER
// ==================================================================================

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActivityType, 
    Partials, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    MessageFlags 
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone');
const fs = require('fs');

// Set Timezone to US (New York / EST)
moment.tz.setDefault("America/New_York");

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V9",
    VERSION: "9.1.0-LEGACY",
    DB_FILE: "database.json", 
    
    // --- Strategy Filters ---
    FILTERS: {
        MIN_MCAP: 20000,         
        MAX_MCAP: 55000,         
        MIN_LIQ: 1500,           
        MIN_VOL_H1: 500,         
        MAX_AGE_MIN: 60,         
        MIN_AGE_MIN: 1,          
        REQUIRE_SOCIALS: true,   
        ANTI_SPAM_NAMES: true    
    },

    // --- Tracking & Auto-Trading Logic ---
    TRACKER: {
        GAIN_TRIGGER_1: 45,      
        GAIN_TRIGGER_2: 100,     
        GAIN_TRIGGER_3: 500,     
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
        DAILY_CHECK_INTERVAL: 60000,
        STATUS_UPDATE_INTERVAL: 60000,
        SAVE_INTERVAL: 60000 * 5     
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
        if (m < 1) return '🔥 New';
        if (m < 60) return `${m}m`;
        return `${Math.floor(m/60)}h ${m%60}m`;
    },

    getHeaders: () => {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json'
        };
    },

    log: (type, source, msg) => {
        const t = moment().format('HH:mm:ss');
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', DAILY: '📅', SAVE: '💾', STATUS: '📶' };
        console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
    }
};

// ==================================================================================
//  🧠  MEMORY & PERSISTENCE (STATE MANAGER)
// ==================================================================================

class StateManager {
    constructor() {
        this.activeTracks = new Map();     
        this.history = new Set();          
        this.processing = new Set();       
        this.queue = [];                   
        
        this.stats = {
            daily: {},   
            weekly: {},  
            monthly: {}, 
            lastReport: { day: null, week: null, month: null }
        };

        this.systemStats = { calls: 0, rugs: 0, start: Date.now() };
        this.loadData(); 
    }

    saveData() {
        try {
            const dump = {
                daily: this.stats.daily,
                weekly: this.stats.weekly,
                monthly: this.stats.monthly,
                lastReport: this.stats.lastReport
            };
            fs.writeFileSync(CONFIG.DB_FILE, JSON.stringify(dump, null, 2));
        } catch (e) {
            Utils.log('ERROR', 'Save', `Failed to save DB: ${e.message}`);
        }
    }

    loadData() {
        if (!fs.existsSync(CONFIG.DB_FILE)) return;
        try {
            const raw = fs.readFileSync(CONFIG.DB_FILE);
            const data = JSON.parse(raw);
            this.stats.daily = data.daily || {};
            this.stats.weekly = data.weekly || {};
            this.stats.monthly = data.monthly || {};
            this.stats.lastReport = data.lastReport || {};
            Utils.log('SUCCESS', 'System', 'Database loaded successfully.');
        } catch (e) {
            Utils.log('ERROR', 'Load', 'Corrupt DB file, starting fresh.');
        }
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
        
        const entry = {
            name: data.name,
            symbol: data.symbol,
            entry: data.price,
            maxGain: 0,
            time: Date.now(),
            status: 'ACTIVE'
        };

        this.stats.daily[address] = { ...entry };
        this.stats.weekly[address] = { ...entry };
        this.stats.monthly[address] = { ...entry };
        this.saveData(); 
    }

    updatePeak(address, gain, status = 'ACTIVE') {
        const update = (timeframe) => {
            if (this.stats[timeframe][address]) {
                const rec = this.stats[timeframe][address];
                if (gain > rec.maxGain) rec.maxGain = gain;
                rec.status = status;
            }
        };
        update('daily'); update('weekly'); update('monthly');
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

        let status = 'Unknown Source';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'Raydium';
        if (dex.includes('pump')) status = 'Pump.Fun';

        return { safe, hype, status, vol, liq, fdv };
    }
}

// ==================================================================================
//  📡  RESTORED SCANNING ENGINE (FROM V8)
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
        price: parseFloat(pair.priceUsd) 
    });
    
    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
}

function handleErr(source, e) {
    if (!e.response || e.response.status !== 429) {}
}

// ==================================================================================
//  💬  DISCORD SENDER (RICK STYLE UI)
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
    const info = pair.info || {};
    const socials = info.socials || [];
    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    
    let badge = '⚡'; 
    if (source === 'BOOST') badge = '🚀';
    if (source === 'PROFILE') badge = '💎';
    
    const mcapShort = Utils.formatUSD(analysis.fdv);
    const title = `${badge} ${token.name} [${mcapShort}] - ${token.symbol}/SOL`;

    const age = Utils.getAge(pair.pairCreatedAt);
    const price = parseFloat(pair.priceUsd);
    const change1h = pair.priceChange?.h1 || 0;
    
    let body = `**${analysis.status}** 🔥 \n`;
    body += `💵 **USD:** \`${Utils.formatPrice(price)}\`\n`;
    body += `💎 **FDV:** \`${mcapShort}\`\n`;
    body += `💧 **Liq:** \`${Utils.formatUSD(analysis.liq)}\`\n`;
    body += `📊 **Vol:** \`${Utils.formatUSD(analysis.vol)}\` • **Age:** \`${age}\`\n`;

    const changeEmoji = change1h >= 0 ? '🟢' : '🔴';
    body += `📈 **1H:** \`${change1h}%\` ${changeEmoji}\n`;

    if (socials.length > 0) {
        const socialLinks = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ');
        body += `\n🔗 ${socialLinks}`;
    }

    const embed = new EmbedBuilder()
        .setColor(change1h >= 0 ? '#00FF00' : '#FF0000') 
        .setTitle(title)
        .setURL(dexLink)
        .setDescription(body)
        .setFooter({ text: `${CONFIG.BOT_NAME} • ${moment().format('h:mm A z')}` });

    if (info.imageUrl) embed.setThumbnail(info.imageUrl);
    if (info.header) embed.setImage(info.header);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Buy on GMGN')
            .setStyle(ButtonStyle.Link)
            .setURL(CONFIG.URLS.REFERRAL),
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
            entry: price,
            entryMcap: analysis.fdv,
            maxGain: 0,
            msgId: msg.id,
            chanId: channel.id,
            t1: false, t2: false, t3: false,
            start: Date.now()
        });
        
        STATE.systemStats.calls++;
        Utils.log('SUCCESS', 'Discord', `Sent Alert: ${token.name}`);
    } catch (e) {
        Utils.log('ERROR', 'Discord', e.message);
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith('copy_')) {
        const ca = interaction.customId.split('_')[1];
        await interaction.reply({ 
            content: `\`${ca}\``, 
            flags: MessageFlags.Ephemeral 
        });
    }
});

// ==================================================================================
//  📅  SCHEDULER (DAILY, WEEKLY, MONTHLY)
// ==================================================================================

function initScheduler() {
    setInterval(async () => {
        const now = moment();
        const dateStr = now.format("YYYY-MM-DD");
        const weekStr = now.format("YYYY-WW");
        const monthStr = now.format("YYYY-MM");
        
        if (now.hour() === 0 && now.minute() === 0) {
            if (STATE.stats.lastReport.day !== dateStr) {
                await sendRecap('daily', `📅 DAILY RECAP: ${moment().subtract(1, 'days').format('MMMM Do')}`);
                STATE.stats.lastReport.day = dateStr;
                STATE.stats.daily = {}; 
                STATE.saveData();
            }
            if (now.day() === 1 && STATE.stats.lastReport.week !== weekStr) {
                await sendRecap('weekly', `📅 WEEKLY RECAP: Week ${now.week() - 1}`);
                STATE.stats.lastReport.week = weekStr;
                STATE.stats.weekly = {}; 
                STATE.saveData();
            }
            if (now.date() === 1 && STATE.stats.lastReport.month !== monthStr) {
                await sendRecap('monthly', `📅 MONTHLY RECAP: ${moment().subtract(1, 'months').format('MMMM')}`);
                STATE.stats.lastReport.month = monthStr;
                STATE.stats.monthly = {}; 
                STATE.saveData();
            }
        }
    }, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendRecap(timeframe, title) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const data = STATE.stats[timeframe];
    const sorted = Object.values(data).sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);
    if (sorted.length === 0) return;

    let description = `**${title}**\n\n`;
    sorted.forEach((coin, index) => {
        let icon = coin.maxGain > 500 ? '👑' : (coin.maxGain > 100 ? '🚀' : '🟢');
        if (coin.status === 'RUG') icon = '💀';
        description += `\`#${index + 1}\` ${icon} **$${coin.symbol}** (+${coin.maxGain.toFixed(0)}%)\n`;
    });

    const embed = new EmbedBuilder()
        .setColor('#FFD700').setTitle(`🏆 ${timeframe.toUpperCase()} TOP PERFORMERS`)
        .setDescription(description).setTimestamp();

    try { await channel.send({ embeds: [embed] }); } catch (e) {}
}

// ==================================================================================
//  📈  TRACKER & STATUS
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
            const currMcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const gain = ((currPrice - data.entry) / data.entry) * 100;

            STATE.updatePeak(addr, gain, 'ACTIVE');

            if (currPrice < (data.entry * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                await sendUpdate(data, currMcap, gain, 'RUG');
                STATE.updatePeak(addr, gain, 'RUG');
                STATE.activeTracks.delete(addr);
                continue;
            }

            if (gain > data.maxGain) data.maxGain = gain;
            if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) { await sendUpdate(data, currMcap, gain, 'GAIN'); data.t1 = true; }
            else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_2 && !data.t2) { await sendUpdate(data, currMcap, gain, 'MOON'); data.t2 = true; }
            else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_3 && !data.t3) { await sendUpdate(data, currMcap, gain, 'GOD'); data.t3 = true; }
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
        let color = type === 'RUG' ? '#FF0000' : (type === 'GOD' ? '#FFD700' : '#00FF00');
        let title = type === 'RUG' ? `🚨 STOP LOSS / RUG` : `🚀 GAIN: +${gain.toFixed(0)}%`;
        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(`**${data.name}**\nEntry: \`${Utils.formatUSD(data.entryMcap)}\` → Now: \`${Utils.formatUSD(currentMcap)}\``).setTimestamp();
        await msg.reply({ embeds: [embed] });
    } catch (e) {}
}

async function updateSolanaStatus() {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112`);
        const pair = res.data?.pairs?.[0];
        if (pair) {
            const price = parseFloat(pair.priceUsd).toFixed(2);
            const change = pair.priceChange?.h24 || 0;
            client.user.setActivity(`SOL: $${price} ${change >= 0 ? '▲' : '▼'} ${change}%`, { type: ActivityType.Watching });
        }
    } catch (e) {}
}

// ==================================================================================
//  🔧  COMMANDS
// ==================================================================================

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!test') {
        const embed = new EmbedBuilder().setColor('#00FF00').setTitle('🟢 GREEN CHIP - ACTIVE').setDescription(`**Time:** ${moment().format('MMMM Do YYYY, h:mm:ss a z')}\n**Tracking:** ${STATE.activeTracks.size} tokens`);
        await m.reply({ embeds: [embed] });
    }
    if (m.content.startsWith('!top')) {
        const args = m.content.split(' ');
        let timeframe = args[1] === 'week' ? 'weekly' : (args[1] === 'month' ? 'monthly' : 'daily');
        await sendRecap(timeframe, `📅 ${timeframe.toUpperCase()} LEADERBOARD (Live)`);
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'ONLINE', version: CONFIG.VERSION }));
app.listen(process.env.PORT || 3000);

client.once('ready', () => {
    Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
    scanProfiles(); scanBoosts(); scanSearch(); runTracker(); processQueue(); initScheduler();
    updateSolanaStatus(); setInterval(updateSolanaStatus, CONFIG.SYSTEM.STATUS_UPDATE_INTERVAL);
});

client.login(process.env.DISCORD_TOKEN);
