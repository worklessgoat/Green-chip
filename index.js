const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SERVER (Keeps bot alive on Render) ---
const app = express();
app.get('/', (req, res) => res.send('🟢 Green Chip ELITE is Live'));
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
const ruggedCoins = new Set(); // Stores rugged coins

// --- ⚙️ ELITE FILTERS (The "Goldilocks" Zone) ---
const MIN_MCAP = 15000;       // $15k (Early)
const MAX_MCAP = 80000;       // $80k (Before Moon)
const MIN_LIQUIDITY = 1500;   // Safety Floor
const MIN_VOL_H1 = 800;       // Momentum
const MAX_AGE_HOURS = 72;     // Only fresh coins (< 3 days)
const REQUIRE_SOCIALS = true; // MUST have Twitter/Telegram

// --- 1. LOGIN & START ---
client.once('ready', () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🟢 GREEN CHIP ELITE ACTIVATED 🟢    ║
║   Mode: High Conviction Sniper        ║
║   Status: HUNTING 24/7                ║
╚═══════════════════════════════════════╝
    `);

    client.user.setPresence({
        activities: [{ name: '🎯 Sniping 100x Gems', type: ActivityType.Watching }],
        status: 'online'
    });

    // FAST SCAN (Every 15s)
    setInterval(scanMarket, 15000);
    // GAIN TRACKING (Every 30s)
    setInterval(trackGains, 30000);
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
            .setTitle('📊 Green Chip Elite Stats')
            .addFields(
                { name: '🟢 Active Calls', value: `${activeCalls.size}`, inline: true },
                { name: '🔴 Rugs Caught', value: `${ruggedCoins.size}`, inline: true },
                { name: '⚡ Scan Speed', value: '15s', inline: true }
            );
        message.channel.send({ embeds: [embed] });
    }
});

// --- 3. ELITE MARKET SCANNER ---
async function scanMarket() {
    try {
        const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana');
        if (!data.pairs) return;

        const now = Date.now();

        for (const pair of data.pairs) {
            // 1. Basic Checks
            if (pair.chainId !== 'solana') continue;
            if (activeCalls.has(pair.pairAddress)) continue;
            if (ruggedCoins.has(pair.pairAddress)) continue;

            // 2. Extract Data
            const mcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const volH1 = pair.volume?.h1 || 0;
            const priceChange = pair.priceChange?.h1 || 0;
            
            // 3. Age Calculation
            const createdAt = pair.pairCreatedAt || now;
            const ageHours = (now - createdAt) / (1000 * 60 * 60);

            // 4. Graduation Check (PumpFun vs Raydium)
            const isRaydium = pair.dexId === 'raydium';
            const graduationStatus = isRaydium ? "✅ Graduated to Raydium" : "⏳ Pump.fun / Ongoing";

            // 5. Socials Check
            const socials = pair.info?.socials || [];
            const hasSocials = socials.length > 0;

            // --- FILTER LOGIC ---
            const isGemZone = mcap >= MIN_MCAP && mcap <= MAX_MCAP;
            const isSafe = liq >= MIN_LIQUIDITY;
            const isMoving = volH1 >= MIN_VOL_H1;
            const isPumping = priceChange > 0;
            const isFresh = ageHours <= MAX_AGE_HOURS;
            const passesSocials = REQUIRE_SOCIALS ? hasSocials : true;

            if (isGemZone && isSafe && isMoving && isPumping && isFresh && passesSocials) {
                console.log(`🎯 ELITE FIND: ${pair.baseToken.name}`);
                await sendEliteAlert(pair, process.env.CHANNEL_ID, graduationStatus, ageHours);
            }
        }
    } catch (err) {
        console.error("Scanner Error:", err.message);
    }
}

// --- 4. ELITE ALERT SENDER ---
async function sendEliteAlert(pair, channelId, gradStatus, ageHours) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const mcap = pair.fdv || pair.marketCap;
    const price = parseFloat(pair.priceUsd);
    
    // Format Social Links
    const socials = pair.info?.socials || [];
    const twitter = socials.find(s => s.type === 'twitter')?.url;
    const telegram = socials.find(s => s.type === 'telegram')?.url;
    const website = socials.find(s => s.type === 'website')?.url;
    
    let socialText = "";
    if (twitter) socialText += `[🐦 Twitter](${twitter}) `;
    if (telegram) socialText += `[✈️ Telegram](${telegram}) `;
    if (website) socialText += `[🌐 Web](${website})`;
    if (!socialText) socialText = "⚠️ **No Socials** (Degen Play)";

    // Age Badge
    const ageBadge = ageHours < 24 ? '🆕 FRESH (<24h)' : '📅 Recent (<72h)';

    const embed = new EmbedBuilder()
        .setTitle(`🎯 **GREEN CHIP CALL: ${pair.baseToken.name}**`)
        .setColor('#00FF41') // Matrix Green
        .setDescription(`
**${ageBadge}**
${gradStatus}
${socialText}
        `)
        .addFields(
            { name: '💎 Market Cap', value: `$${mcap.toLocaleString()}`, inline: true },
            { name: '💰 Price', value: `$${price}`, inline: true },
            { name: '🌊 Liquidity', value: `$${pair.liquidity.usd.toLocaleString()}`, inline: true },
            { name: '📊 1h Vol', value: `$${(pair.volume?.h1 || 0).toLocaleString()}`, inline: true },
            { name: '📈 1h Change', value: `+${pair.priceChange?.h1}%`, inline: true },
            { name: '⚡ FAST BUY', value: `[👉 **TRADE ON GMGN (LOWER FEES)**](https://gmgn.ai/r/Greenchip)` },
            { name: '📝 Contract', value: `\`${pair.baseToken.address}\`` }
        )
        .setThumbnail(pair.info?.imageUrl || null)
        .setFooter({ text: 'Green Chip • Elite Sniper • Auto Gain Tracking Active' })
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

// --- 5. GAIN TRACKER & THREADED REPLIES ---
async function trackGains() {
    if (activeCalls.size === 0) return;

    for (const [pairAddress, data] of activeCalls) {
        try {
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
            if (!res.data.pairs || res.data.pairs.length === 0) continue;

            const currentPair = res.data.pairs[0];
            const currentPrice = parseFloat(currentPair.priceUsd);
            const currentLiq = currentPair.liquidity?.usd || 0;

            // RUG CHECK (<$500 Liq)
            if (currentLiq < 500) {
                activeCalls.delete(pairAddress);
                ruggedCoins.add(pairAddress);
                await sendRugAlert(data);
                continue;
            }

            // GAIN CALCULATION
            const gainPct = ((currentPrice - data.initialPrice) / data.initialPrice) * 100;

            // ALERT TRIGGERS: +45%, +100%, +200%...
            if (gainPct >= 45 && gainPct > data.highestGain) {
                // Only alert if gain increased by significant step (+20%)
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
            // Gold for 100%+, Green for normal
            const color = gainPct >= 100 ? '#FFD700' : '#00FF00';
            const emoji = gainPct >= 100 ? '👑' : '🚀';
            
            const gainEmbed = new EmbedBuilder()
                .setTitle(`${emoji} **GAIN UPDATE: +${gainPct.toFixed(2)}%**`)
                .setColor(color)
                .setDescription(`**${data.name}** is flying!\nCurrent Price: $${currentPrice}\n\n[👉 **Sell/Buy on GMGN**](https://gmgn.ai/r/Greenchip)`);
            
            await originalMsg.reply({ embeds: [gainEmbed] });
        }
    } catch (err) {
        console.log("Could not find original message.");
    }
}

// --- 7. RUG ALERT ---
async function sendRugAlert(data) {
    const channel = client.channels.cache.get(data.channelId);
    if (!channel) return;
    try {
        const originalMsg = await channel.messages.fetch(data.msgId);
        if (originalMsg) {
            const rugEmbed = new EmbedBuilder()
                .setTitle(`⚠️ **RUG DETECTED**`)
                .setColor('#FF0000')
                .setDescription(`Liquidity removed for **${data.name}**. Tracking stopped.`);
            await originalMsg.reply({ embeds: [rugEmbed] });
        }
    } catch (e) {}
}

// --- 8. FORCE SCAN (Debug) ---
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
