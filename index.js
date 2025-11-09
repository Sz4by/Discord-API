// Csomagok betöltése
require('dotenv').config(); // .env fájl változóinak betöltése
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Express (API) szerver beállítása
const app = express();
const port = process.env.PORT || 3000; // Az API ezen a porton fog futni

// Discord kliens (Bot) beállítása
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences, // Ez kell a státusz olvasásához!
        GatewayIntentBits.GuildMembers     // Ez kell a tagok listázásához
    ]
});

// A bot "lelke", itt tároljuk a TE státuszodat (gyorsítótár)
let userStatusData = {
    status: 'offline',
    avatar: '',
    username: '',
    activities: []
};

// --- Bot Logika ---

// Amikor a bot sikeresen elindult
client.on('ready', async () => {
    console.log(`✅ Bejelentkezve mint ${client.user.tag}`);
    await fetchUserData(); // Megpróbáljuk azonnal lekérni a te adataidat
});

// Amikor valakinek (így a tiéd is) megváltozik a státusza
client.on('presenceUpdate', (oldPresence, newPresence) => {
    // Csak a te USER_ID-ddal törődünk (a .env fájlból)
    if (newPresence.userId === process.env.USER_ID) {
        console.log('Saját státusz frissítve!');
        updateStatusData(newPresence);
    }
});

// Függvény a te felhasználói adataid lekérésére (gyorsítótárazáshoz)
async function fetchUserData() {
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        if (!guild) {
            console.error('Hiba: A megadott GUILD_ID-val nem található szerver.');
            return;
        }

        const member = await guild.members.fetch(process.env.USER_ID);
        if (!member) {
            console.error('Hiba: A felhasználó (USER_ID) nem található ezen a szerveren.');
            return;
        }
        
        updateStatusData(member.presence, member.user);

    } catch (err) {
        console.error('Hiba történt a felhasználói adatok lekérése közben:', err);
        userStatusData = {
            status: 'offline',
            avatar: userStatusData.avatar || '',
            username: userStatusData.username || '',
            activities: []
        };
    }
}

// Függvény, ami elmenti a TE státuszodat a gyorsítótárba
function updateStatusData(presence, user = null) {
    if (!presence) {
        userStatusData.status = 'offline';
        userStatusData.activities = [];
        return;
    }

    const targetUser = user || presence.user;
    if (targetUser) {
        userStatusData.username = targetUser.username;
        userStatusData.avatar = targetUser.displayAvatarURL();
    }
    
    userStatusData.status = presence.status;
    
    userStatusData.activities = presence.activities
        .filter(activity => activity.name)
        .map(activity => {
            let details = {
                type: activity.type,
                name: activity.name,
                details: activity.details || null,
                state: activity.state || null
            };

            if (activity.name === 'Spotify' && activity.assets) {
                details.albumArtUrl = `https://i.scdn.co/image/${activity.assets.largeImage.split(':')[1]}`;
                details.song = activity.details;
                details.artist = activity.state;
            }

            return details;
        });
}


// *** ÚJ FÜGGVÉNY ***
// Ez a függvény formázza meg BÁRKI jelenléti adatát, anélkül, hogy elmentené
function formatPresenceData(presence, user) {
    // Alapértelmezett adatok, ha a felhasználó offline
    let data = {
        status: 'offline',
        avatar: user ? user.displayAvatarURL() : '',
        username: user ? user.username : '',
        activities: []
    };

    // Ha a felhasználó offline, a presence 'null'
    if (!presence) {
        return data;
    }

    // Felhasználónév és avatar (biztonsági mentés, ha 'user' nem jött át)
    if (!data.username && presence.user) {
        data.username = presence.user.username;
    }
    if (!data.avatar && presence.user) {
        data.avatar = presence.user.displayAvatarURL();
    }

    // Státusz (online, idle, dnd)
    data.status = presence.status;
    
    // Aktivitások (játék, zene, stb.) szűrése és formázása
    data.activities = presence.activities
        .filter(activity => activity.name)
        .map(activity => {
            let details = {
                type: activity.type,
                name: activity.name,
                details: activity.details || null,
                state: activity.state || null
            };

            if (activity.name === 'Spotify' && activity.assets) {
                details.albumArtUrl = `https://i.scdn.co/image/${activity.assets.largeImage.split(':')[1]}`;
                details.song = activity.details;
                details.artist = activity.state;
            }

            return details;
        });

    return data;
}


// --- API Szerver Logika ---

// CORS beállítása, hogy a weboldalad hozzáférjen
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Engedélyezés mindenhonnan
    next();
});

// 1. VÉGPONT: A TE STÁTUSZOD (Gyorsítótárazott)
// Használat: http://localhost:3000/api/status
app.get('/api/status', (req, res) => {
    // Visszaküldjük a tárolt státusz adatokat
    res.json(userStatusData);
});


// *** ÚJ VÉGPONT ***
// 2. VÉGPONT: BÁRKI STÁTUSZA ID ALAPJÁN (Élő lekérés)
// Használat: http://localhost:3000/api/status/123456789...
app.get('/api/status/:userId', async (req, res) => {
    try {
        const { userId } = req.params; // Kiolvassuk az ID-t az URL-ből

        // 1. Megkeressük a szervert
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        if (!guild) {
            return res.status(500).json({ error: 'Szerver nem található (konfigurációs hiba)' });
        }
        
        // 2. "Élőben" lekérjük a felhasználót (member) a szerverről az ID alapján
        const member = await guild.members.fetch(userId);
        if (!member) {
            return res.status(404).json({ error: 'Felhasználó nem található ezen a szerveren' });
        }

        // 3. Formázzuk az adatokat az új 'formatPresenceData' függvényünkkel
        // A 'member.presence' 'null' lehet, ha offline, a 'member.user' pedig az alap adatokat adja
        const formattedData = formatPresenceData(member.presence, member.user);
        
        // 4. Visszaküldjük az adatot
        res.json(formattedData);

    } catch (err) {
        // Általános hibakezelés (pl. ha az ID érvénytelen)
        console.error(`API hiba a(z) ${req.params.userId} ID-vel:`, err.message);
        // Ha az ID nem létezik, a Discord "Unknown Member" vagy "Unknown User" hibát dob
        if (err.code === 10007 || err.code === 10013) { 
             return res.status(404).json({ error: 'Felhasználó nem található' });
        }
        res.status(500).json({ error: 'Belső szerverhiba történt' });
    }
});


// A szerver indítása
app.listen(port, () => {
    console.log(`🚀 Az API szerver fut a http://localhost:${port} címen`);
});

// A bot indítása (mindig a végén legyen)
client.login(process.env.DISCORD_TOKEN);
