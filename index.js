const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SERVER (Keeps bot alive on Render) ---
const app = express();
app.get('/', (req, res) => res.send('🟢 Green Chip GOD MODE is Live'));
app.listen(3000, () => console.log('✅ Web Server Ready'));

// --- BOT CONFIG ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- MEMORY SYSTEM ---
const activeCalls = new Map(); // Stores active trades
const ruggedCoins = new Set(); // Stores rugged coins to ignore

// --- ⚙️ GOD MODE SETTINGS (Tuned for ~20 Calls/Day) ---
const MIN_MCAP = 15000;       // $15k (Catch them early)
const MAX_MCAP = 70000;       // $70k (Catch them before they moon)
const MIN_LIQUIDITY = 1500;   // Safety floor
const MIN_VOL_H1 = 1000;      // Must have active volume
const REQUIRE_SOCIALS = true; // MUST have Twitter or Telegram
const MIN_GAIN_REPLY = 45;    // Reply at +45% gain

// --- 1. LOGIN & START ---
client.once('ready', () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🟢 GREEN CHIP GOD MODE ACTIVE 🟢    ║
║   Status: HUNTING 24/7                ║
║   Range: $15k - $70k MCap             ║
╚═══════════════════════════════════════╝
    `);

    client.user.setActivity('Solana Market 24/7', { type: ActivityType.Watching });

    // FAST SCAN (Every 15 seconds)
    setInterval(scanMarket, 15000);
    
    // GAIN TRACKING (Every 45 seconds)
    setInterval(trackGains, 45000);
});

// --- 2. COMMANDS ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // !force - Instantly pulls 3 live coins to prove connection
    if (message.content === '!force') {
        message.channel.send("🔍 **Forcing Live Market Scan...**");
        await forceScan(message.channel.id);
    }

    // !stats - Show bot health
    if (message.content === '!stats') {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('📊 Green Chip Stats')
            .addFields(
                { name: '🟢 Active Trades', value: `${activeCalls.size}`, inline: true },
                { name: '🔴 Rugs Detected', value: `${ruggedCoins.size}`, inline: true },
                { name: '⚡ Scan Speed', value: '15s', inline: true }
            );
        message.channel.send({ embeds: [embed] });
    }
});

// --- 3. MARKET SCANNER ---
async function scanMarket() {
    try {
        // Fetch Solana pairs from DexScreener
        const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana');
        if (!data.pairs) return;

        for (const pair of data.pairs) {
            // 1. Basic Checks
            if (pair.chainId !== 'solana') continue;
            if (activeCalls.has(pair.pairAddress)) continue; // Don't call twice
            if (ruggedCoins.has(pair.pairAddress)) continue;

            // 2. Extract Data
            const mcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const volH1 = pair.volume?.h1 || 0;
            const priceChange = pair.priceChange?.h1 || 0;
            
            // 3. Socials Check
            const socials = pair.info?.socials || [];
            const hasTwitter = socials.some(s => s.type === 'twitter');
            const hasTelegram = socials.some(s => s.type === 'telegram');
            const hasSocials = hasTwitter || hasTelegram;

            // --- 4. THE FILTER LOGIC ---
            const isGemZone = mcap >= MIN_MCAP && mcap <= MAX_MCAP;
            const isSafe = liq >= MIN_LIQUIDITY;
            const isMoving = volH1 >= MIN_VOL_H1;
            const isPumping = priceChange > 0; // Must be green
            const passesSocials = REQUIRE_SOCIALS ? hasSocials : true;

            if (isGemZone && isSafe && isMoving && isPumping && passesSocials) {
                console.log(`🎯 FOUND GEM: ${pair.baseToken.name}`);
                await sendAlert(pair, process.env.CHANNEL_ID);
            }
        }
    } catch (err) {
        console.error("Scanner Error:", err.message);
    }
}

// --- 4. ALERT SENDER ---
async function sendAlert(pair, channelId) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const mcap = pair.fdv || pair.marketCap;
    const price = parseFloat(pair.priceUsd);
    
    // Format Social Links
    const socials = pair.info?.socials || [];
    const twitter = socials.find(s => s.type === 'twitter')?.url;
    const telegram = socials.find(s => s.type === 'telegram')?.url;
    
    let socialText = "";
    if (twitter) socialText += `[🐦 Twitter](${twitter}) `;
    if (telegram) socialText += `[✈️ Telegram](${telegram})`;
    if (!socialText) socialText = "⚠️ No Socials (Risky)";

    const embed = new EmbedBuilder()
        .setTitle(`🚀 **GREEN CHIP CALL: ${pair.baseToken.name}**`)
        .setColor('#00FF00') // Neon Green
        .setDescription(`**High Conviction Play**\n${socialText}`)
        .addFields(
            { name: '💎 Market Cap', value: `$${mcap.toLocaleString()}`, inline: true },
            { name: '💰 Price', value: `$${price}`, inline: true },
            { name: '🌊 Liquidity', value: `$${pair.liquidity.usd.toLocaleString()}`, inline: true },
            { name: '📊 1h Volume', value: `$${(pair.volume?.h1 || 0).toLocaleString()}`, inline: true },
            { name: '⚡ FAST BUY', value: `[👉 **TRADE ON GMGN (LOWER FEES)**](https://gmgn.ai/r/Greenchip)` },
            { name: '📝 Contract', value: `\`${pair.baseToken.address}\`` }
        )
        .setThumbnail(pair.info?.imageUrl || null)
        .setFooter({ text: 'Green Chip • God Mode • Auto Gain Tracking' })
        .setTimestamp();

    const msg = await channel.send({ embeds: [embed] });

    // Save to Memory
    activeCalls.set(pair.pairAddress, {
        name: pair.baseToken.name,
        initialPrice: price,
        msgId: msg.id,
        channelId: channel.id,
        highestGain: 0,
        address: pair.baseToken.address
    });
}

// --- 5. GAIN TRACKER & REPLIES ---
async function trackGains() {
    if (activeCalls.size === 0) return;

    for (const [pairAddress, data] of activeCalls) {
        try {
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
            if (!res.data.pairs || res.data.pairs.length === 0) continue;

            const currentPair = res.data.pairs[0];
            const currentPrice = parseFloat(currentPair.priceUsd);
            const currentLiq = currentPair.liquidity?.usd || 0;

            // RUG CHECK
            if (currentLiq < 500) {
                activeCalls.delete(pairAddress);
                ruggedCoins.add(pairAddress);
                continue;
            }

            // GAIN CALCULATION
            const gainPct = ((currentPrice - data.initialPrice) / data.initialPrice) * 100;

            // CHECK TRIGGERS (45%, 100%, 200%, etc)
            if (gainPct >= MIN_GAIN_REPLY && gainPct > data.highestGain) {
                // Only alert if gain increased by at least 20% since last alert
                if (gainPct > (data.highestGain + 20)) {
                    data.highestGain = gainPct;
                    await sendReply(data, gainPct, currentPrice);
                }
            }
        } catch (e) { console.error(e.message); }
    }
}

// --- 6. REPLY FUNCTION ---
async function sendReply(data, gainPct, currentPrice) {
    const channel = client.channels.cache.get(data.channelId);
    if (!channel) return;

    try {
        const originalMsg = await channel.messages.fetch(data.msgId);
        if (originalMsg) {
            // Color Logic: Gold for 100%+, Green for 45%+
            const color = gainPct >= 100 ? '#FFD700' : '#00FF00';
            
            const gainEmbed = new EmbedBuilder()
                .setTitle(`📈 **GAIN UPDATE: +${gainPct.toFixed(2)}%**`)
                .setColor(color)
                .setDescription(`**${data.name}** is pumping!\nCurrent Price: $${currentPrice}\n\n[👉 **Sell/Buy on GMGN**](https://gmgn.ai/r/Greenchip)`);
            
            await originalMsg.reply({ embeds: [gainEmbed] });
        }
    } catch (err) {
        console.log("Could not find original message.");
    }
}

// --- 7. FORCE SCAN (Debug Tool) ---
async function forceScan(channelId) {
    try {
        const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana');
        const top3 = data.pairs.slice(0, 3);
        const channel = client.channels.cache.get(channelId);
        
        for (const pair of top3) {
            await channel.send(`**LIVE MARKET CHECK:** ${pair.baseToken.name} | $${pair.priceUsd}`);
        }
    } catch (e) { console.error(e); }
}

client.login(process.env.DISCORD_TOKEN);
