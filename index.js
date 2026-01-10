const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SERVER (Keeps bot alive) ---
const app = express();
app.get('/', (req, res) => res.send('Green Chip SNIPER is Live 🟢'));
app.listen(3000, () => console.log('Server ready.'));

// --- BOT CONFIG ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// MEMORY
const activeCalls = new Set();

// --- ⚙️ SNIPER SETTINGS (The "Moon Shot" Zone) ---
const MIN_MCAP = 4000;         // Catch them extremely early ($4k)
const MAX_MCAP = 90000;        // Stop calling after $90k (Too late)
const MIN_LIQUIDITY = 1000;    // Must have $1k+ backing
const MIN_VOL_H1 = 500;        // Must be trading actively NOW
const REQUIRE_SOCIALS = true;  // MUST have Twitter/Telegram to be called

// --- 1. LOGIN & START ---
client.once('ready', () => {
    console.log(`✅ LOGGED IN AS: ${client.user.tag}`);
    console.log(`🔫 SNIPER MODE: $4k - $90k MCap | Socials Only`);
    
    // Fast Scan (Every 15s)
    setInterval(scanMarket, 15000);
});

// --- 2. COMMANDS ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // "!force" = PROVE connection by fetching real live data immediately
    if (message.content === '!force') {
        message.channel.send("🔍 Fetching LIVE raw market data (Top 3 Newest)...");
        await forceScan(message.channel.id);
    }
});

// --- 3. THE "SNIPER" SCANNER ---
async function scanMarket() {
    try {
        // Fetch latest Solana profiles
        const url = 'https://api.dexscreener.com/latest/dex/search?q=solana';
        const { data } = await axios.get(url);
        
        if (!data.pairs) return;

        for (const pair of data.pairs) {
            if (pair.chainId !== 'solana') continue;
            if (activeCalls.has(pair.pairAddress)) continue; // Don't repeat calls

            // EXTRACT DATA
            const mcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const volH1 = pair.volume?.h1 || 0; // 1-Hour Volume (Momentum)
            
            // SOCIAL CHECK (The "Realness" Test)
            const hasSocials = pair.info?.socials && pair.info.socials.length > 0;
            const twitter = pair.info?.socials?.find(s => s.type === 'twitter')?.url;
            const telegram = pair.info?.socials?.find(s => s.type === 'telegram')?.url;

            // --- FILTER LOGIC ---
            const isGemZone = mcap >= MIN_MCAP && mcap <= MAX_MCAP;
            const isSafe = liq >= MIN_LIQUIDITY;
            const isMoving = volH1 >= MIN_VOL_H1;
            const passesSocials = REQUIRE_SOCIALS ? hasSocials : true;

            if (isGemZone && isSafe && isMoving && passesSocials) {
                console.log(`🎯 SNIPED: ${pair.baseToken.name}`);
                await sendAlert(pair, process.env.CHANNEL_ID, twitter, telegram);
                activeCalls.add(pair.pairAddress);
            }
        }
    } catch (err) {
        console.error("Scan Error:", err.message);
    }
}

// --- 4. FORCE SCAN (Proof of Work) ---
async function forceScan(channelId) {
    try {
        const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana');
        const top3 = data.pairs.slice(0, 3); // Get top 3 raw results
        
        const channel = client.channels.cache.get(channelId);
        
        for (const pair of top3) {
            const mcap = pair.fdv || pair.marketCap || 0;
            await channel.send(`**LIVE MARKET CHECK:** ${pair.baseToken.name} | MCap: $${mcap.toLocaleString()} | Price: $${pair.priceUsd}`);
        }
        await channel.send("✅ **Connection Verified.** Bot is scanning for perfect calls...");
    } catch (e) {
        console.error(e);
    }
}

// --- 5. THE PROFESSIONAL ALERT ---
async function sendAlert(pair, channelId, twitter, telegram) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const mcap = pair.fdv || pair.marketCap;
    const price = parseFloat(pair.priceUsd);
    
    // Social Links Formatting
    let socialLinks = "";
    if (twitter) socialLinks += `[🐦 Twitter](${twitter}) `;
    if (telegram) socialLinks += `[✈️ Telegram](${telegram})`;
    if (!socialLinks) socialLinks = "⚠️ No Socials Linked (High Risk)";

    const embed = new EmbedBuilder()
        .setTitle(`🔫 **SNIPER ALERT: ${pair.baseToken.name}**`)
        .setColor('#00FF00') // Neon Green
        .setDescription(`**New Gem Detected in Golden Zone ($4k-$90k)**\n${socialLinks}`)
        .addFields(
            { name: '💎 Market Cap', value: `$${mcap.toLocaleString()}`, inline: true },
            { name: '💰 Price', value: `$${price}`, inline: true },
            { name: '🌊 Liquidity', value: `$${pair.liquidity.usd.toLocaleString()}`, inline: true },
            { name: '🔥 1h Volume', value: `$${(pair.volume?.h1 || 0).toLocaleString()}`, inline: true },
            { name: '⚡ FAST BUY', value: `[👉 **TRADE ON GMGN**](https://gmgn.ai/sol/token/${pair.baseToken.address})` },
            { name: '📝 Contract', value: `\`${pair.baseToken.address}\`` }
        )
        .setImage(`https://dd.dexscreener.com/ds-data/tokens/solana/${pair.baseToken.address}.png`) // Auto-fetch token image
        .setFooter({ text: 'Green Chip • Real-Time Sniper • Verified Socials' })
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
