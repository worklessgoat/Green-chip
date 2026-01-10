const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SETUP ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// KEEP ALIVE (WEB SERVER)
const app = express();
app.get('/', (req, res) => res.send('Green Chip is Active 🟢'));
app.listen(3000, () => console.log('Server is ready.'));

// CONFIGURATION
const CHANNEL_ID = process.env.CHANNEL_ID; 
const TRACKING_INTERVAL = 30000; // 30 Seconds

// STORAGE
let trackedPairs = new Set(); 

// --- MAIN BOT LOGIC ---
client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    runScanner();
});

async function runScanner() {
    setInterval(async () => {
        try {
            // 1. Get Solana Token Data from DexScreener
            const url = 'https://api.dexscreener.com/latest/dex/search?q=solana';
            const { data } = await axios.get(url);
            
            if (!data.pairs) return;

            // 2. Filter Coins
            for (const pair of data.pairs) {
                if (pair.chainId !== 'solana') continue;
                if (trackedPairs.has(pair.pairAddress)) continue; // Skip if seen

                const mcap = pair.fdv || pair.marketCap;
                const liquidity = pair.liquidity?.usd || 0;
                const vol = pair.volume?.h24 || 0;

                // YOUR RULES: $20k - $55k MCap, Good Liquidity
                if (mcap >= 20000 && mcap <= 55000 && liquidity > 1000 && vol > 500) {
                    
                    // 3. Send Alert
                    await sendDiscordAlert(pair);
                    trackedPairs.add(pair.pairAddress);
                }
            }
        } catch (err) {
            console.error("Scanner Error:", err.message);
        }
    }, TRACKING_INTERVAL);
}

async function sendDiscordAlert(pair) {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(`🚨 **GREEN CHIP CALL: ${pair.baseToken.name}**`)
        .setColor('#00FF00')
        .setDescription(`**High Potential Meme Coin Detected**`)
        .addFields(
            { name: '💎 Market Cap', value: `$${(pair.fdv || pair.marketCap).toLocaleString()}`, inline: true },
            { name: '💰 Price', value: `$${pair.priceUsd}`, inline: true },
            { name: '💧 Liquidity', value: `$${pair.liquidity.usd.toLocaleString()}`, inline: true },
            { name: '📝 Contract', value: `\`${pair.baseToken.address}\`` },
            { name: '⚡ LOWER FEES LINK', value: '[👉 **CLICK TO TRADE ON GMGN**](https://gmgn.ai/r/Greenchip)' }
        )
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
